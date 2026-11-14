/**
 * English grapheme-to-phoneme conversion and ONNX Runtime helpers for
 * Paradee-8M. Ported from huangyingting/neural-readalong
 * (`src/lib/phonemize.ts`, `src/lib/paradee-g2p.ts`, Apache-2.0), keeping only
 * the English path (eSpeak-NG WASM + Misaki symbol conversion).
 *
 * Model files are served by ReadWise itself (see `ONDEVICE_TTS_ASSET_PATHS`);
 * the ONNX Runtime WASM binary is emitted by the bundler as a hashed
 * `/_next/static/media/` asset. Nothing loads from a third-party CDN.
 */
import * as ort from "onnxruntime-web";
import { phonemize as espeakng } from "phonemizer";
import { normalizeText } from "./text-normalize";
import type { ModelLoadProgress } from "./types";

export const ONDEVICE_TTS_ASSET_PATHS = {
  modelConfig: "/models/paradee-8m-v1.3/config.json",
  model: "/models/paradee-8m-v1.3/paradee_int8.onnx",
} as const;

/**
 * Cache Storage bucket for the public model files. Deliberately outside the
 * service worker's `readwise-` prefix, which is purged on every SW upgrade and
 * on sign-out; the model holds no private data. Bump the version when the
 * hosted model files change.
 */
export const ONDEVICE_TTS_CACHE_NAME = "ondevice-tts-paradee-v1";

// ── eSpeak-NG IPA → Misaki phonemes ────────────────────────────────────────

const E2M_RULES: ReadonlyArray<readonly [string, string]> = [
  ["ʔˌn̩", "ʔn"],
  ["ʔn̩", "ʔn"],
  ["aɪ", "I"],
  ["aʊ", "W"],
  ["dʒ", "ʤ"],
  ["eɪ", "A"],
  ["e", "A"],
  ["tʃ", "ʧ"],
  ["ɔɪ", "Y"],
  ["ʲo", "jo"],
  ["ʲə", "jə"],
  ["ʲ", ""],
  ["ɚ", "əɹ"],
  ["r", "ɹ"],
  ["x", "k"],
  ["ç", "k"],
  ["ɬ", "l"],
  ["̃", ""],
];

/**
 * Converts eSpeak-NG English IPA into the Misaki/Kokoro phoneme alphabet
 * expected by Paradee-8M (`af_heart`, `am_puck`, `bf_isabella`, `bm_fable`).
 */
export function toMisaki(ps: string, british = false): string {
  let out = ps;
  if (british) {
    out = out.split("eə").join("ɛː");
  }
  for (const [src, dst] of E2M_RULES) {
    out = out.split(src).join(dst);
  }
  out = out.replace(/(\S)̩/gu, "ᵊ$1").replace(/̩/g, "");
  out = out.replace(/əl(?=[\s;:,.!?—…"“”()]|$)/gu, "ᵊl");
  out = british
    ? out.replace(/ɐ(?!n?(?:[\s;:,.!?—…"“”()]|$))/gu, "ə")
    : out.replace(/ɐ(?![\s;:,.!?—…"“”()]|$)/gu, "ə");
  if (british) {
    out = out.split("iə").join("ɪə").split("əʊ").join("Q");
    out = out.replace(/(^|\s)ðɪ(?=\s|$)/gu, "$1ði");
  } else {
    out = out
      .split("oʊ")
      .join("O")
      .split("ɜːɹ")
      .join("ɜɹ")
      .split("ɜː")
      .join("ɜɹ")
      .split("ɪə")
      .join("iə")
      .split("ː")
      .join("");
  }
  out = out.split("o").join("ɔ");
  return out.split("ɾ").join("T").split("ʔ").join("t");
}

export function normalizeParadeeEnglishText(text: string): string {
  return normalizeText(text).replace(/«/g, "(").replace(/»/g, ")");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ENGLISH_PUNCTUATION = ';:,.!?¡¿—…"()“”{}[]';
const ENGLISH_PUNCTUATION_PATTERN = new RegExp(
  `(\\s*[${escapeRegExp(ENGLISH_PUNCTUATION)}]+\\s*)+`,
  "g",
);

function splitKeepingDelimiters(
  text: string,
  regex: RegExp,
): Array<{ match: boolean; text: string }> {
  const result: Array<{ match: boolean; text: string }> = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    const matchIndex = match.index ?? 0;
    if (prev < matchIndex) {
      result.push({ match: false, text: text.slice(prev, matchIndex) });
    }
    if (fullMatch.length > 0) {
      result.push({ match: true, text: fullMatch });
    }
    prev = matchIndex + fullMatch.length;
  }
  if (prev < text.length) {
    result.push({ match: false, text: text.slice(prev) });
  }
  return result;
}

/**
 * Phonemizes American (`british = false`) or British (`british = true`)
 * English text for Paradee-8M using eSpeak-NG WASM + `toMisaki`.
 */
export async function phonemizeParadeeEnglish(
  rawText: string,
  british = false,
): Promise<string> {
  const text = normalizeParadeeEnglishText(rawText);
  if (!text) return "";

  const sections = splitKeepingDelimiters(text, ENGLISH_PUNCTUATION_PATTERN);
  // phonemizer's bundled eSpeak-NG exposes "en-us" (American) and "en" (British RP).
  const espeakVoice = british ? "en" : "en-us";

  // eSpeak-NG keeps global WASM state, so phonemize sections sequentially.
  const parts: string[] = [];
  for (const section of sections) {
    if (section.match) {
      parts.push(section.text);
    } else {
      const ipaLines = await espeakng(section.text, espeakVoice);
      parts.push(ipaLines.join(" "));
    }
  }

  return toMisaki(
    parts
      .join("")
      .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
      .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
      .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
      .replace(/ z(?=[;:,.!?¡¿—…"()“” ]|$)/g, "z"),
    british,
  ).trim();
}

// ── ONNX Runtime helpers ───────────────────────────────────────────────────

let ortConfigured = false;

function ensureOrtWebConfigured(): void {
  if (ortConfigured || !ort.env?.wasm) return;
  ortConfigured = true;
  // wasmPaths stays unset: onnxruntime-web resolves its .wasm via
  // `new URL(..., import.meta.url)`, which the bundler emits same-origin.
  // Already inside a dedicated worker; no extra proxy worker needed.
  ort.env.wasm.proxy = false;
}

let sessionCreationChain: Promise<unknown> = Promise.resolve();
let sessionRunChain: Promise<unknown> = Promise.resolve();

export async function createSerializedOrtSession(
  modelBytes: Uint8Array,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> {
  ensureOrtWebConfigured();
  const create = () => ort.InferenceSession.create(modelBytes, options);
  const next = sessionCreationChain.then(create, create);
  sessionCreationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function runSerializedOrtSession(
  session: ort.InferenceSession,
  feeds: ort.InferenceSession.FeedsType,
): Promise<ort.InferenceSession.ReturnType> {
  const run = () => session.run(feeds);
  const next = sessionRunChain.then(run, run);
  sessionRunChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Fetches a same-origin model asset, caching it in Cache Storage so later
 * visits load the model without re-downloading.
 */
export async function fetchCachedBytes(
  url: string,
  options: {
    fileLabel?: string;
    progressCallback?: (info: ModelLoadProgress) => void;
  } = {},
): Promise<Uint8Array> {
  const { fileLabel = url.split("/").pop() ?? "model", progressCallback } = options;

  let cache: Cache | undefined;
  if (typeof caches !== "undefined") {
    try {
      cache = await caches.open(ONDEVICE_TTS_CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) {
        const buf = new Uint8Array(await cached.arrayBuffer());
        progressCallback?.({ file: fileLabel, loaded: buf.byteLength, total: buf.byteLength, progress: 100 });
        return buf;
      }
    } catch {
      cache = undefined;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fileLabel} (HTTP ${response.status})`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  let bytes: Uint8Array;
  if (response.body && totalBytes > 0 && progressCallback) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        loaded += value.byteLength;
        progressCallback({ file: fileLabel, loaded, total: totalBytes, progress: (loaded / totalBytes) * 100 });
      }
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    progressCallback?.({ file: fileLabel, loaded: bytes.byteLength, total: bytes.byteLength, progress: 100 });
  }

  if (cache) {
    try {
      await cache.put(
        url,
        new Response(bytes.slice().buffer, {
          headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
        }),
      );
    } catch {
      // Cache Storage is best-effort (quota, private mode).
    }
  }
  return bytes;
}
