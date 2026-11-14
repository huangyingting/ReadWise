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

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

// ── Text normalization (Kokoro/Misaki conventions) ─────────────────────────

function splitNum(match: string): string {
  if (match.includes(".")) {
    return match;
  } else if (match.includes(":")) {
    const [h, m] = match.split(":").map(Number);
    if (m === 0) {
      return `${h} o'clock`;
    } else if (m < 10) {
      return `${h} oh ${m}`;
    }
    return `${h} ${m}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) {
    return match;
  }
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) {
      return `${left} hundred${suffix}`;
    } else if (right < 10) {
      return `${left} oh ${right}${suffix}`;
    }
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(match: string): string {
  const bill = match[0] === "$" ? "dollar" : "pound";
  if (Number.isNaN(Number(match.slice(1)))) {
    return `${match.slice(1)} ${bill}s`;
  } else if (!match.includes(".")) {
    const suffix = match.slice(1) === "1" ? "" : "s";
    return `${match.slice(1)} ${bill}${suffix}`;
  }
  const [b, c] = match.slice(1).split(".");
  const d = parseInt((c ?? "").padEnd(2, "0"), 10);
  const coins =
    match[0] === "$"
      ? d === 1
        ? "cent"
        : "cents"
      : d === 1
        ? "penny"
        : "pence";
  return `${b} ${bill}${b === "1" ? "" : "s"} and ${d} ${coins}`;
}

function pointNum(match: string): string {
  const [a, b] = match.split(".");
  return `${a} point ${(b ?? "").split("").join(" ")}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/g, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(
      /\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g,
      splitNum,
    )
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      flipMoney,
    )
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

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
  if (isNodeRuntime()) {
    return session.run(feeds);
  }
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
