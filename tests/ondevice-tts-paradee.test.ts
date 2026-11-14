/**
 * Live Paradee-8M synthesis from the self-hosted model files
 * (public/models/paradee-8m-v1.3) on ONNX Runtime WASM, plus the word
 * alignment the Reader uses for highlighting.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { toSpeechWords } from "@/lib/ondevice-tts/narration";
import { PARADEE_DURATIONS_TENSOR, ParadeeTTS, patchOnnxGraphOutput } from "@/lib/ondevice-tts/paradee";
import { toMisaki } from "@/lib/ondevice-tts/paradee-g2p";
import { buildChunkAlignment, splitTextWithOffsets } from "@/lib/ondevice-tts/word-timestamps";

const MODEL_DIR = "public/models/paradee-8m-v1.3";

test("patchOnnxGraphOutput exposes the durations tensor idempotently", () => {
  const graphBody = new Uint8Array([0x0a, 0x01, 0x67]);
  const modelProto = new Uint8Array([0x08, 0x08, (7 << 3) | 2, graphBody.length, ...graphBody]);
  const patched = patchOnnxGraphOutput(modelProto, PARADEE_DURATIONS_TENSOR);
  assert.ok(new TextDecoder().decode(patched).includes(PARADEE_DURATIONS_TENSOR));
  assert.equal(patchOnnxGraphOutput(patched, PARADEE_DURATIONS_TENSOR).byteLength, patched.byteLength);
});

// ── Minimal protobuf encoder for synthetic ONNX graphs ─────────────────────
function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}
const key = (field: number, wire: number) => varint((field << 3) | wire);
const bytes = (field: number, payload: number[]) => [...key(field, 2), ...varint(payload.length), ...payload];
const text = (field: number, value: string) => bytes(field, Array.from(new TextEncoder().encode(value)));
const fixed64 = (field: number) => [...key(field, 1), 1, 2, 3, 4, 5, 6, 7, 8];
const fixed32 = (field: number) => [...key(field, 5), 1, 2, 3, 4];
const int = (field: number, value: number) => [...key(field, 0), ...varint(value)];

function node(inputs: string[], outputs: string[], opType: string, extra: number[] = []): number[] {
  return bytes(1, [
    ...inputs.flatMap((name) => text(1, name)),
    ...outputs.flatMap((name) => text(2, name)),
    ...text(3, `${opType}_node`),
    ...text(4, opType),
    ...extra,
  ]);
}
const initializer = (name: string, prefix: number[] = []) => bytes(5, [...prefix, ...text(8, name)]);
const model = (graph: number[], prefix: number[] = []) => new Uint8Array([...prefix, ...bytes(7, graph)]);
const decode = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

test("patchOnnxGraphOutput rewrites WebGPU-incompatible nodes and prunes their orphaned inputs", () => {
  const graph = [
    ...int(9, 1),
    ...fixed64(10),
    ...fixed32(11),
    ...node([], ["c_flip"], "Constant"),
    ...node(["/head/RandomNormalLike_output_0", "c_flip", "init_ends"], ["flip_out"], "Slice"),
    ...node(["w_q", "w_s", "w_z"], ["w"], "DequantizeLinear", bytes(5, text(1, "axis"))),
    ...node([], ["c_keep"], "Constant"),
    ...node(["c_keep", "w", "flip_out"], ["y"], "Add", [...int(7, 3), ...fixed64(8), ...fixed32(9)]),
    // A node whose inner field overruns is left untouched.
    ...bytes(1, [...key(1, 2), 40, 0x61]),
    // A node with an unknown wire type is left untouched.
    ...bytes(1, [...key(1, 3)]),
    ...initializer("init_ends", [...int(1, 1), ...fixed64(2), ...fixed32(3)]),
    ...initializer("w_z"),
    ...initializer("w_q"),
    ...bytes(5, int(1, 4)), // unnamed initializer
    ...bytes(5, [...key(8, 2), 40]), // initializer whose name overruns
    ...bytes(5, [...key(9, 3)]), // initializer with an unknown wire type
  ];
  const patched = decode(patchOnnxGraphOutput(model(graph, [...int(1, 8), ...fixed64(2), ...fixed32(3)])));

  // The Slice node's input name plus its new op type.
  assert.equal(patched.split("RandomNormalLike").length - 1, 2, "Slice op is replaced by RandomNormalLike");
  assert.ok(patched.includes(PARADEE_DURATIONS_TENSOR));
  for (const pruned of ["c_flip", "init_ends", "w_z"]) assert.ok(!patched.includes(pruned), `${pruned} should be pruned`);
  for (const kept of ["c_keep", "w_q", "w_s", "flip_out", "axis"]) assert.ok(patched.includes(kept), `${kept} should remain`);
  assert.equal(patched.split("Slice").length - 1, 1, "only the node name keeps 'Slice'");
});

test("patchOnnxGraphOutput rejects malformed models", () => {
  assert.throws(() => patchOnnxGraphOutput(new Uint8Array([0x08, 0x80])), /Truncated varint/);
  assert.throws(() => patchOnnxGraphOutput(new Uint8Array([...key(7, 2), 10, 0x0a])), /Corrupt length-delimited field in ONNX protobuf/);
  assert.throws(() => patchOnnxGraphOutput(new Uint8Array(int(1, 1))), /No GraphProto/);
  assert.throws(() => patchOnnxGraphOutput(new Uint8Array([...key(1, 3), ...bytes(7, [])])), /No GraphProto/);
  assert.throws(
    () => patchOnnxGraphOutput(model([...key(1, 2), 50, 0x01])),
    /Corrupt length-delimited field in ONNX GraphProto/,
  );
  // An unknown wire type ends graph parsing; the output is still appended.
  const tail = decode(patchOnnxGraphOutput(model([...text(2, "g"), ...key(15, 3)])));
  assert.ok(tail.includes(PARADEE_DURATIONS_TENSOR));
});

test("toMisaki converts American and British eSpeak IPA", () => {
  assert.equal(toMisaki("fˈaɪv thˈaʊzənd dˈeɪz əv hˈoʊm", false), "fˈIv thˈWzənd dˈAz əv hˈOm");
  assert.equal(toMisaki("hˈəʊm fˈeə flˈɒks", true), "hˈQm fˈɛː flˈɒks");
});

test("synthesizes speech with word timings mapped onto the source text", async () => {
  const config = JSON.parse(readFileSync(`${MODEL_DIR}/config.json`, "utf8"));
  const model = new Uint8Array(readFileSync(`${MODEL_DIR}/paradee_int8.onnx`));
  const tts = await ParadeeTTS.fromBytes(config, model, "wasm");
  const text = `The studio isn't in the US. In 1996, it opened with "$30 million" of investment!`;
  try {
    let totalSamples = 0;
    let wordIndex = 0;
    const aligned = [];
    for (const [chunkIndex, span] of splitTextWithOffsets(text, 200).entries()) {
      const out = await tts.generate(span.text, { voice: "af_heart" });
      assert.equal(out.sampleRate, 24_000);
      assert.equal(out.durations?.length, out.tokens?.length);
      let peak = 0;
      for (const sample of out.samples) {
        assert.ok(Number.isFinite(sample));
        peak = Math.max(peak, Math.abs(sample));
      }
      assert.ok(peak > 0.01, `expected audible speech, peak=${peak}`);
      const alignment = buildChunkAlignment({
        chunkIndex,
        span,
        tokens: out.tokens,
        durations: out.durations,
        chunkSamples: out.samples.length,
        totalSamplesBeforeChunk: totalSamples,
        sampleRate: out.sampleRate,
        startingWordIndex: wordIndex,
      });
      totalSamples += out.samples.length;
      wordIndex += alignment.words.length;
      aligned.push(...alignment.words);
    }

    const words = toSpeechWords(aligned);
    assert.deepEqual(
      words.map((w) => w.word),
      ["The", "studio", "isn't", "in", "the", "US", "In", "1996", "it", "opened", "with", "30", "million", "of", "investment"],
    );
    const audioMs = (totalSamples / 24_000) * 1000;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      assert.equal(text.slice(w.textStart, w.textEnd), w.word);
      assert.ok(w.startMs <= w.endMs && w.endMs <= audioMs + 1);
      if (i > 0) assert.ok(w.startMs >= words[i - 1]!.startMs);
    }
  } finally {
    await tts.dispose();
  }
});
