/**
 * Paradee-8M v1.3 on-device text-to-speech (English voices).
 *
 * Ported from huangyingting/neural-readalong (`src/lib/paradee.ts`,
 * Apache-2.0). The ONNX graph is patched at load time to expose Paradee's
 * per-token duration frames (`/Clip_output_0`, 600 samples = 25 ms each) for
 * word highlighting, and to rewrite two node patterns that break ONNX
 * Runtime's WebGPU kernels. Weights are untouched.
 *
 * Model: https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.3 (Apache-2.0),
 * self-hosted under /models/paradee-8m-v1.3/.
 */
import * as ort from "onnxruntime-web";
import {
  createSerializedOrtSession,
  fetchCachedBytes,
  ONDEVICE_TTS_ASSET_PATHS,
  phonemizeParadeeEnglish,
  runSerializedOrtSession,
} from "./paradee-g2p";
import type { ModelLoadProgress, RuntimeDevice } from "./types";
import { DEFAULT_PARADEE_VOICE, isParadeeEnglishVoice } from "./voices";

export const PARADEE_SAMPLE_RATE = 24000;
export const PARADEE_MAX_PHONEMES = 510;
export const PARADEE_DURATIONS_TENSOR = "/Clip_output_0";

interface ParadeeConfigJson {
  sample_rate?: number;
  voices: string[];
  vocab: Record<string, number>;
}

export interface ParadeeGenerateResult {
  samples: Float32Array;
  sampleRate: number;
  tokens?: string[];
  durations?: Float32Array;
}

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  // Support lengths > 32-bit safely using arithmetic division.
  let num = value;
  while (num > 0x7f) {
    bytes.push((num & 0x7f) | 0x80);
    num = Math.floor(num / 128);
  }
  bytes.push(num & 0x7f);
  return new Uint8Array(bytes);
}

function readVarint(
  buffer: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  let value = 0;
  let multiplier = 1;
  let idx = offset;
  while (idx < buffer.length) {
    const byte = buffer[idx++];
    value += (byte & 0x7f) * multiplier;
    if (byte < 0x80) {
      return { value, nextOffset: idx };
    }
    multiplier *= 128;
  }
  throw new Error("Truncated varint in ONNX protobuf");
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const arr of arrays) total += arr.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.byteLength;
  }
  return out;
}

function encodeLengthDelimitedField(
  fieldNumber: number,
  payload: Uint8Array,
): Uint8Array {
  const key = encodeVarint((fieldNumber << 3) | 2);
  const length = encodeVarint(payload.byteLength);
  return concatBytes(key, length, payload);
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function encodeNodeProto(node: {
  inputs: readonly string[];
  outputs: readonly string[];
  name: string;
  opType: string;
  attributes?: readonly Uint8Array[];
}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const inp of node.inputs) {
    parts.push(encodeLengthDelimitedField(1, UTF8_ENCODER.encode(inp)));
  }
  for (const out of node.outputs) {
    parts.push(encodeLengthDelimitedField(2, UTF8_ENCODER.encode(out)));
  }
  if (node.name) {
    parts.push(encodeLengthDelimitedField(3, UTF8_ENCODER.encode(node.name)));
  }
  parts.push(encodeLengthDelimitedField(4, UTF8_ENCODER.encode(node.opType)));
  if (node.attributes) {
    for (const attr of node.attributes) {
      parts.push(encodeLengthDelimitedField(5, attr));
    }
  }
  return concatBytes(...parts);
}

/**
 * AttributeProto `{ name: "dtype", i: 1 (TensorProto.FLOAT), type: INT (2) }`
 * matching ONNX `RandomNormalLike` float32 attribute encoding.
 */
const RANDOM_NORMAL_FLOAT_DTYPE_ATTR = concatBytes(
  encodeLengthDelimitedField(1, UTF8_ENCODER.encode("dtype")),
  new Uint8Array([0x18, 0x01, 0xa0, 0x01, 0x02]),
);

interface ParsedNodeSummary {
  inputs: string[];
  outputs: string[];
  name: string;
  opType: string;
  attributes: Uint8Array[];
}

function parseNodeSummary(nodeBytes: Uint8Array): ParsedNodeSummary | null {
  const inputs: string[] = [];
  const outputs: string[] = [];
  const attributes: Uint8Array[] = [];
  let name = "";
  let opType = "";

  let offset = 0;
  while (offset < nodeBytes.byteLength) {
    const keyRes = readVarint(nodeBytes, offset);
    offset = keyRes.nextOffset;
    const wireType = keyRes.value & 7;
    const fieldNumber = Math.floor(keyRes.value / 8);

    if (wireType === 0) {
      offset = readVarint(nodeBytes, offset).nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 2) {
      const lenRes = readVarint(nodeBytes, offset);
      const start = lenRes.nextOffset;
      const end = start + lenRes.value;
      if (end > nodeBytes.byteLength) {
        return null;
      }
      const slice = nodeBytes.subarray(start, end);
      if (fieldNumber === 1) {
        inputs.push(UTF8_DECODER.decode(slice));
      } else if (fieldNumber === 2) {
        outputs.push(UTF8_DECODER.decode(slice));
      } else if (fieldNumber === 3) {
        name = UTF8_DECODER.decode(slice);
      } else if (fieldNumber === 4) {
        opType = UTF8_DECODER.decode(slice);
      } else if (fieldNumber === 5) {
        attributes.push(slice);
      }
      offset = end;
    } else {
      return null;
    }
  }

  return { inputs, outputs, name, opType, attributes };
}

function rewriteParadeeNodeForWebGPU(
  parsed: ParsedNodeSummary,
): { encoded: Uint8Array; droppedInputs: string[] } | null {
  const { inputs, outputs, name, opType, attributes } = parsed;

  // 1. WebGPU negative-step Slice bug workaround:
  // Paradee v1.3's burst STFT (`nz.flip(-1)` -> `/head/Slice_27`) exports as
  // `Slice(data=/head/RandomNormalLike_output_0, starts=[-1], ends=[-9223372036854775807], axes=[-1], steps=[-1])`.
  // `onnxruntime-web`'s WebGPU `Slice` kernel (`fixStartEndValues`) clamps negative `ends` to `0` instead of `-1`
  // when `step < 0`, dropping 1 sample (`[1, S-1]`), shrinking `/head/Conv_6` by 1 STFT frame, and crashing
  // `/head/Mul_41` with `[WebGPU] Kernel "[Mul] /head/Mul_41" failed. Error: Can't perform binary op on the given tensors`.
  // Replacing `/head/Slice_27` with an independent `RandomNormalLike` produces an exact `[1, S]` i.i.d. N(0, 1)
  // Gaussian white-noise source decorrelated from the main STFT noise without triggering negative-step `Slice`.
  if (
    opType === "Slice" &&
    inputs[0] === "/head/RandomNormalLike_output_0" &&
    outputs.length === 1
  ) {
    return {
      encoded: encodeNodeProto({
        inputs: [inputs[0]],
        outputs,
        name,
        opType: "RandomNormalLike",
        attributes: [RANDOM_NORMAL_FLOAT_DTYPE_ATTR],
      }),
      droppedInputs: inputs.slice(1),
    };
  }

  // 2. WebGPU per-axis DequantizeLinear WGSL shader semicolon bug workaround (`paradee_int8.onnx`):
  // All 105 `*_z` zero-point initializers in `paradee_int8.onnx` are symmetric all-zero int8 vectors.
  // `onnxruntime-web`'s WebGPU `DequantizeLinear` shader omits a semicolon when a 1D packed int8 zero-point input
  // is supplied (`quantize-linear.ts`), whereas omitting the optional all-zero 3rd input in opset 17 is identical
  // and uses the valid zero-default WGSL branch.
  if (
    opType === "DequantizeLinear" &&
    inputs.length === 3 &&
    inputs[2].endsWith("_z")
  ) {
    return {
      encoded: encodeNodeProto({
        inputs: inputs.slice(0, 2),
        outputs,
        name,
        opType,
        attributes,
      }),
      droppedInputs: [inputs[2]],
    };
  }

  return null;
}

function parseProtoStringField(
  msgBytes: Uint8Array,
  targetFieldNumber: number,
): string {
  let offset = 0;
  while (offset < msgBytes.byteLength) {
    const keyRes = readVarint(msgBytes, offset);
    offset = keyRes.nextOffset;
    const wireType = keyRes.value & 7;
    const fieldNumber = Math.floor(keyRes.value / 8);
    if (wireType === 0) {
      offset = readVarint(msgBytes, offset).nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 2) {
      const lenRes = readVarint(msgBytes, offset);
      const start = lenRes.nextOffset;
      const end = start + lenRes.value;
      if (end > msgBytes.byteLength) return "";
      if (fieldNumber === targetFieldNumber) {
        return UTF8_DECODER.decode(msgBytes.subarray(start, end));
      }
      offset = end;
    } else {
      return "";
    }
  }
  return "";
}

function patchGraphProtoBody(
  graphBody: Uint8Array,
  outputName: string,
  outputField: Uint8Array,
): Uint8Array {
  // Pass 1: Identify rewritten nodes and any tensor names orphaned by dropping unused inputs
  const candidateOrphans = new Set<string>();
  const retainedInputs = new Set<string>();
  let pass1Offset = 0;
  while (pass1Offset < graphBody.byteLength) {
    const keyRes = readVarint(graphBody, pass1Offset);
    pass1Offset = keyRes.nextOffset;
    const wireType = keyRes.value & 7;
    const fieldNumber = Math.floor(keyRes.value / 8);
    if (wireType === 0) {
      pass1Offset = readVarint(graphBody, pass1Offset).nextOffset;
    } else if (wireType === 1) {
      pass1Offset += 8;
    } else if (wireType === 5) {
      pass1Offset += 4;
    } else if (wireType === 2) {
      const lenRes = readVarint(graphBody, pass1Offset);
      const bodyStart = lenRes.nextOffset;
      const bodyEnd = bodyStart + lenRes.value;
      if (bodyEnd > graphBody.byteLength) {
        throw new Error("Corrupt length-delimited field in ONNX GraphProto");
      }
      if (fieldNumber === 1) {
        const parsed = parseNodeSummary(graphBody.subarray(bodyStart, bodyEnd));
        if (parsed) {
          const rewrite = rewriteParadeeNodeForWebGPU(parsed);
          if (rewrite) {
            for (const dropped of rewrite.droppedInputs) {
              candidateOrphans.add(dropped);
            }
            retainedInputs.add(parsed.inputs[0]);
            if (parsed.opType === "DequantizeLinear" && parsed.inputs[1]) {
              retainedInputs.add(parsed.inputs[1]);
            }
          } else {
            for (const inp of parsed.inputs) {
              retainedInputs.add(inp);
            }
          }
        }
      }
      pass1Offset = bodyEnd;
    } else {
      break;
    }
  }

  for (const used of retainedInputs) {
    candidateOrphans.delete(used);
  }

  // Pass 2: Emit patched GraphProto while pruning orphaned Constant nodes & TensorProto initializers
  const chunks: Uint8Array[] = [];
  let copyStart = 0;
  let offset = 0;
  let alreadyHasOutput = false;

  while (offset < graphBody.byteLength) {
    const fieldStart = offset;
    const keyRes = readVarint(graphBody, offset);
    offset = keyRes.nextOffset;
    const wireType = keyRes.value & 7;
    const fieldNumber = Math.floor(keyRes.value / 8);

    if (wireType === 0) {
      offset = readVarint(graphBody, offset).nextOffset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 2) {
      const lenRes = readVarint(graphBody, offset);
      const bodyStart = lenRes.nextOffset;
      const bodyEnd = bodyStart + lenRes.value;

      if (fieldNumber === 1) {
        const parsed = parseNodeSummary(graphBody.subarray(bodyStart, bodyEnd));
        if (parsed) {
          if (
            parsed.opType === "Constant" &&
            parsed.outputs.length === 1 &&
            candidateOrphans.has(parsed.outputs[0])
          ) {
            if (fieldStart > copyStart) {
              chunks.push(graphBody.subarray(copyStart, fieldStart));
            }
            copyStart = bodyEnd;
          } else {
            const rewrite = rewriteParadeeNodeForWebGPU(parsed);
            if (rewrite) {
              if (fieldStart > copyStart) {
                chunks.push(graphBody.subarray(copyStart, fieldStart));
              }
              chunks.push(encodeLengthDelimitedField(1, rewrite.encoded));
              copyStart = bodyEnd;
            }
          }
        }
      } else if (fieldNumber === 5 && candidateOrphans.size > 0) {
        // TensorProto.name is field 8
        const initName = parseProtoStringField(
          graphBody.subarray(bodyStart, bodyEnd),
          8,
        );
        if (initName && candidateOrphans.has(initName)) {
          if (fieldStart > copyStart) {
            chunks.push(graphBody.subarray(copyStart, fieldStart));
          }
          copyStart = bodyEnd;
        }
      } else if (fieldNumber === 12) {
        // ValueInfoProto.name is field 1
        if (
          parseProtoStringField(graphBody.subarray(bodyStart, bodyEnd), 1) ===
          outputName
        ) {
          alreadyHasOutput = true;
        }
      }

      offset = bodyEnd;
    } else {
      break;
    }
  }

  if (copyStart < graphBody.byteLength) {
    chunks.push(graphBody.subarray(copyStart));
  }
  if (!alreadyHasOutput) {
    chunks.push(outputField);
  }
  return concatBytes(...chunks);
}

/**
 * Exposes internal float tensor `outputName` (default `"/Clip_output_0"`, Paradee's exact
 * rounded per-token durations in 600-sample frames) as an additional ONNX `GraphProto.output`
 * (field 12 of `ModelProto.graph` field 7) and rewrites WebGPU-incompatible ONNX node patterns
 * (`/head/Slice_27` negative-step white-noise flip and redundant all-zero `DequantizeLinear` zero-points)
 * without re-exporting or altering weights.
 */
export function patchOnnxGraphOutput(
  modelBytes: Uint8Array,
  outputName = PARADEE_DURATIONS_TENSOR,
): Uint8Array {
  const nameBytes = UTF8_ENCODER.encode(outputName);
  // ValueInfoProto { name: outputName, type: TypeProto { tensor_type: Tensor { elem_type: FLOAT (1) } } }
  const elemTypeFloat = new Uint8Array([0x08, 0x01]);
  const valueInfo = concatBytes(
    encodeLengthDelimitedField(1, nameBytes),
    encodeLengthDelimitedField(2, encodeLengthDelimitedField(1, elemTypeFloat)),
  );
  const outputField = encodeLengthDelimitedField(12, valueInfo);

  let i = 0;
  while (i < modelBytes.byteLength) {
    const fieldStart = i;
    const keyRes = readVarint(modelBytes, i);
    const key = keyRes.value;
    i = keyRes.nextOffset;
    const wireType = key & 7;
    const fieldNumber = Math.floor(key / 8);

    if (wireType === 0) {
      i = readVarint(modelBytes, i).nextOffset;
    } else if (wireType === 1) {
      i += 8;
    } else if (wireType === 5) {
      i += 4;
    } else if (wireType === 2) {
      const lenRes = readVarint(modelBytes, i);
      const bodyStart = lenRes.nextOffset;
      const bodyEnd = bodyStart + lenRes.value;
      if (bodyEnd > modelBytes.byteLength) {
        throw new Error("Corrupt length-delimited field in ONNX protobuf");
      }
      if (fieldNumber === 7) {
        const graphBody = modelBytes.subarray(bodyStart, bodyEnd);
        const patchedGraph = encodeLengthDelimitedField(
          7,
          patchGraphProtoBody(graphBody, outputName, outputField),
        );
        return concatBytes(
          modelBytes.subarray(0, fieldStart),
          patchedGraph,
          modelBytes.subarray(bodyEnd),
        );
      }
      i = bodyEnd;
    } else {
      break;
    }
  }

  throw new Error("No GraphProto (field 7) found in ONNX model bytes");
}

function splitPhonemeStringIntoRuns(
  vocabFilteredPhonemes: string,
  maxLen = PARADEE_MAX_PHONEMES,
): string[] {
  const runs: string[] = [];
  let remaining = vocabFilteredPhonemes.trim();
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen;
    const head = remaining.slice(0, cut).trim();
    if (head) runs.push(head);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) {
    runs.push(remaining);
  }
  return runs;
}


function concatFloat32(parts: readonly Float32Array[]): Float32Array {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function toFloat32(data: unknown): Float32Array {
  return data instanceof Float32Array
    ? new Float32Array(data)
    : Float32Array.from(data as ArrayLike<number>);
}

export class ParadeeTTS {
  readonly sampleRate: number;
  private readonly voiceOrder: readonly string[];
  private readonly vocab: Readonly<Record<string, number>>;
  private session: ort.InferenceSession;
  private activeDevice: RuntimeDevice;
  private readonly patchedModelBytes: Uint8Array;

  private constructor(
    config: ParadeeConfigJson,
    session: ort.InferenceSession,
    activeDevice: RuntimeDevice,
    patchedModelBytes: Uint8Array,
  ) {
    this.sampleRate = config.sample_rate ?? PARADEE_SAMPLE_RATE;
    this.voiceOrder = config.voices;
    this.vocab = config.vocab;
    this.session = session;
    this.activeDevice = activeDevice;
    this.patchedModelBytes = patchedModelBytes;
  }

  /** The execution provider actually in use (WebGPU may fall back to WASM). */
  get device(): RuntimeDevice {
    return this.activeDevice;
  }

  /** Loads the self-hosted INT8 model and config (cached in Cache Storage). */
  static async load({
    device,
    progressCallback,
  }: {
    device: RuntimeDevice;
    progressCallback?: (info: ModelLoadProgress) => void;
  }): Promise<ParadeeTTS> {
    const [configBytes, modelBytes] = await Promise.all([
      fetchCachedBytes(ONDEVICE_TTS_ASSET_PATHS.modelConfig, {
        fileLabel: "config.json",
        progressCallback,
      }),
      fetchCachedBytes(ONDEVICE_TTS_ASSET_PATHS.model, {
        fileLabel: "paradee_int8.onnx",
        progressCallback,
      }),
    ]);
    const config = JSON.parse(new TextDecoder().decode(configBytes)) as ParadeeConfigJson;
    return ParadeeTTS.fromBytes(config, modelBytes, device);
  }

  /** Creates a session from already-loaded config + model bytes. */
  static async fromBytes(
    config: ParadeeConfigJson,
    rawModelBytes: Uint8Array,
    device: RuntimeDevice,
  ): Promise<ParadeeTTS> {
    const patchedModelBytes = patchOnnxGraphOutput(rawModelBytes, PARADEE_DURATIONS_TENSOR);

    // Request WebGPU alone: in ["webgpu", "wasm"] ONNX Runtime silently drops
    // an unavailable WebGPU backend, which would misreport the device.
    if (device === "webgpu") {
      try {
        const session = await createSerializedOrtSession(patchedModelBytes, {
          executionProviders: ["webgpu"],
        });
        return new ParadeeTTS(config, session, "webgpu", patchedModelBytes);
      } catch {
        // Fall through to WASM.
      }
    }
    const session = await createSerializedOrtSession(patchedModelBytes, {
      executionProviders: ["wasm"],
    });
    return new ParadeeTTS(config, session, "wasm", patchedModelBytes);
  }

  private filterToVocab(phonemes: string): string {
    const kept: string[] = [];
    for (const ch of Array.from(phonemes)) {
      if (Object.prototype.hasOwnProperty.call(this.vocab, ch)) {
        kept.push(ch);
      }
    }
    return kept.join("");
  }

  private async runPhonemeSlice(
    vocabPhonemes: string,
    voiceIndex: number,
    speed: number,
  ): Promise<{ samples: Float32Array; tokens: string[]; durations: Float32Array }> {
    const chars = Array.from(vocabPhonemes).slice(0, PARADEE_MAX_PHONEMES);
    const seqLen = chars.length + 2;
    const inputIds = new BigInt64Array(seqLen);
    inputIds[0] = BigInt(0);
    for (let i = 0; i < chars.length; i++) {
      inputIds[i + 1] = BigInt(this.vocab[chars[i]!] ?? 0);
    }
    inputIds[seqLen - 1] = BigInt(0);

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor("int64", inputIds, [1, seqLen]),
      speed: new ort.Tensor("float32", new Float32Array([speed]), [1]),
    };
    if (this.voiceOrder.length > 1) {
      feeds.voice = new ort.Tensor("int64", new BigInt64Array([BigInt(voiceIndex)]), [1]);
    }

    let outputs: ort.InferenceSession.ReturnType;
    try {
      outputs = await runSerializedOrtSession(this.session, feeds);
    } catch (err) {
      if (this.activeDevice !== "webgpu") throw err;
      // A WebGPU kernel failed at run time: rebuild the session on WASM once.
      try {
        await this.session.release();
      } catch {
        // Ignore release failure on a broken WebGPU session.
      }
      this.session = await createSerializedOrtSession(this.patchedModelBytes, {
        executionProviders: ["wasm"],
      });
      this.activeDevice = "wasm";
      outputs = await runSerializedOrtSession(this.session, feeds);
    }

    const durationsTensor = outputs[PARADEE_DURATIONS_TENSOR];
    return {
      samples: toFloat32(outputs.waveform!.data),
      tokens: ["$", ...chars, "$"],
      durations: durationsTensor ? toFloat32(durationsTensor.data) : new Float32Array(0),
    };
  }

  async generate(
    text: string,
    { voice = DEFAULT_PARADEE_VOICE, speed = 1 }: { voice?: string; speed?: number } = {},
  ): Promise<ParadeeGenerateResult> {
    const resolvedVoice = isParadeeEnglishVoice(voice) ? voice : DEFAULT_PARADEE_VOICE;
    const voiceIndex = Math.max(0, this.voiceOrder.indexOf(resolvedVoice));
    const british = resolvedVoice.startsWith("b");

    const rawPhonemes = await phonemizeParadeeEnglish(text, british);
    const runs = splitPhonemeStringIntoRuns(this.filterToVocab(rawPhonemes), PARADEE_MAX_PHONEMES);
    if (runs.length === 0) {
      return { samples: new Float32Array(0), sampleRate: this.sampleRate };
    }

    const sampleParts: Float32Array[] = [];
    const durationParts: Float32Array[] = [];
    const tokens: string[] = [];
    for (const run of runs) {
      const slice = await this.runPhonemeSlice(run, voiceIndex, speed);
      sampleParts.push(slice.samples);
      durationParts.push(slice.durations);
      tokens.push(...slice.tokens);
    }

    return {
      samples: concatFloat32(sampleParts),
      sampleRate: this.sampleRate,
      tokens,
      durations: concatFloat32(durationParts),
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.session.release();
    } catch {
      // Session already released.
    }
  }
}
