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
        samples: out.samples,
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
