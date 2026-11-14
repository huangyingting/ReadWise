/**
 * Sentence chunking and neural word-timestamp alignment for on-device
 * narration. Ported from huangyingting/neural-readalong
 * (`src/lib/word-timestamps.ts`, Apache-2.0), keeping the paths the English
 * Paradee engine uses: offset-preserving sentence chunking, alignment from
 * per-token duration frames, and a character-proportional fallback when a
 * chunk has no usable durations.
 */
import type {
  ChunkAlignment,
  TextChunkSpan,
  TextSegment,
  WordTimestamp,
} from "./types";
import { normalizeText } from "./text-normalize";

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "sgt",
  "col",
  "gen",
  "rep",
  "sen",
  "gov",
  "lt",
  "maj",
  "capt",
  "st",
  "mt",
  "etc",
  "co",
  "inc",
  "ltd",
  "dept",
  "vs",
  "p",
  "pg",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "sun",
  "mon",
  "tu",
  "tue",
  "tues",
  "wed",
  "th",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
]);

function isSentenceTerminator(c: string, includeNewlines = true): boolean {
  return ".!?…。？！।॥".includes(c) || (includeNewlines && c === "\n");
}

function isTrailingChar(c: string): boolean {
  return "\"'”’)]}»」』".includes(c);
}

function isAbbreviation(token: string): boolean {
  const cleaned = token.replace(/['’]s$/i, "").replace(/\.+$/, "");
  return ABBREVIATIONS.has(cleaned.toLowerCase());
}

/**
 * Segments source text into alternating word and whitespace tokens using the exact same
 * `/\s/` boundary semantics as `buildWordAlignmentData`, preserving UTF-16 character spans
 * so every word in the rendered reader maps 1-to-1 to streamed `WordTimestamp` entries.
 */
export function segmentTextIntoWords(text: string): {
  segments: TextSegment[];
  wordCount: number;
} {
  const segments: TextSegment[] = [];
  if (!text) {
    return { segments, wordCount: 0 };
  }

  let wordCount = 0;
  let i = 0;
  while (i < text.length) {
    const isSpace = /\s/.test(text[i]);
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]) === isSpace) {
      j++;
    }
    if (isSpace) {
      segments.push({
        type: "whitespace",
        text: text.slice(i, j),
        charStart: i,
        charEnd: j,
      });
    } else {
      segments.push({
        type: "word",
        text: text.slice(i, j),
        charStart: i,
        charEnd: j,
        wordIndex: wordCount++,
      });
    }
    i = j;
  }

  return { segments, wordCount };
}

function pushTrimmedSpan(
  spans: TextChunkSpan[],
  source: string,
  rawStart: number,
  rawEnd: number,
): void {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/.test(source[start])) {
    start++;
  }
  while (end > start && /\s/.test(source[end - 1])) {
    end--;
  }
  if (start < end) {
    spans.push({
      text: source.slice(start, end),
      charStart: start,
      charEnd: end,
    });
  }
}

/**
 * Splits a single long span on clause punctuation (`,`, `;`, `:`, `—`) followed by whitespace,
 * and falls back to whitespace word boundaries if a clause still exceeds `maxChunkLength`.
 * Always splits strictly on whitespace so words are never broken across chunks and exact
 * substrings of `source` are preserved.
 */
function splitLongSpanWithOffsets(
  source: string,
  spanStart: number,
  spanEnd: number,
  maxChunkLength: number,
): TextChunkSpan[] {
  const results: TextChunkSpan[] = [];

  let cursor = spanStart;
  while (cursor < spanEnd) {
    while (cursor < spanEnd && /\s/.test(source[cursor])) {
      cursor++;
    }
    if (cursor >= spanEnd) break;

    if (spanEnd - cursor <= maxChunkLength) {
      pushTrimmedSpan(results, source, cursor, spanEnd);
      break;
    }

    const limit = Math.min(spanEnd, cursor + maxChunkLength);

    // Prefer splitting after a clause delimiter (comma, semicolon, colon, em-dash) + whitespace
    let splitAt = -1;
    for (let k = limit; k > cursor; k--) {
      if (/\s/.test(source[k]) && /[,;:—]/.test(source[k - 1])) {
        splitAt = k;
        break;
      }
    }

    // Otherwise split at the last whitespace before `limit`
    if (splitAt === -1) {
      for (let k = limit; k > cursor; k--) {
        if (/\s/.test(source[k])) {
          splitAt = k;
          break;
        }
      }
    }

    // If a single contiguous token exceeds `maxChunkLength`, extend to the next whitespace
    // so word boundaries stay intact unless there is no whitespace at all.
    if (splitAt === -1) {
      let nextSpace = limit;
      while (nextSpace < spanEnd && !/\s/.test(source[nextSpace])) {
        nextSpace++;
      }
      splitAt = nextSpace;
    }

    pushTrimmedSpan(results, source, cursor, splitAt);
    cursor = splitAt;
  }

  return results;
}

/**
 * Splits text sentence-by-sentence (matching `kokoro-js` streaming granularity so character-duration
 * word timestamp approximation stays tightly bounded per sentence, as described by Ryan Welch) while
 * preserving exact `[charStart, charEnd)` offsets in the original text.
 */
export function splitTextWithOffsets(
  text: string,
  maxChunkLength = 280,
): TextChunkSpan[] {
  const sentenceSpans: TextChunkSpan[] = [];
  const len = text.length;
  let sentenceStart = 0;
  let i = 0;

  while (i < len) {
    const c = text[i];

    if (isSentenceTerminator(c)) {
      const currentSegment = text.slice(sentenceStart, i);
      // Avoid splitting numbered list prefixes like "1." at start of line
      if (/(^|\n)\s*\d+$/.test(currentSegment) && c === ".") {
        i++;
        continue;
      }

      let boundaryEnd = i;
      if (c !== "\n") {
        while (
          boundaryEnd + 1 < len &&
          isSentenceTerminator(text[boundaryEnd + 1], false)
        ) {
          boundaryEnd++;
        }
        while (boundaryEnd + 1 < len && isTrailingChar(text[boundaryEnd + 1])) {
          boundaryEnd++;
        }
      }

      let nextNonSpace = boundaryEnd + 1;
      while (nextNonSpace < len && /\s/.test(text[nextNonSpace])) {
        nextNonSpace++;
      }

      // Skip mid-token periods like "$9.99" or "3.14"
      if (c !== "\n" && boundaryEnd + 1 === nextNonSpace && nextNonSpace < len) {
        i++;
        continue;
      }

      if (c !== "\n") {
        let tokenStart = i - 1;
        while (tokenStart >= sentenceStart && /\S/.test(text[tokenStart])) {
          tokenStart--;
        }
        tokenStart = Math.max(sentenceStart, tokenStart + 1);
        let tokenEnd = tokenStart;
        while (tokenEnd < len && /\S/.test(text[tokenEnd])) {
          tokenEnd++;
        }
        const token = text.slice(tokenStart, tokenEnd).replace(/^["'“‘(]+/, "");

        if (isAbbreviation(token)) {
          i++;
          continue;
        }

        if (
          /^([A-Za-z]\.)+$/.test(token) &&
          nextNonSpace < len &&
          /[A-Z]/.test(text[nextNonSpace])
        ) {
          i++;
          continue;
        }

        if (
          c === "." &&
          nextNonSpace < len &&
          /[a-z]/.test(text[nextNonSpace])
        ) {
          i++;
          continue;
        }
      }

      const candidate = text.slice(sentenceStart, boundaryEnd + 1).trim();
      if (candidate === "..." || candidate === "…") {
        i++;
        continue;
      }

      pushTrimmedSpan(sentenceSpans, text, sentenceStart, boundaryEnd + 1);
      sentenceStart = boundaryEnd + 1;
      i = sentenceStart;
      continue;
    }

    i++;
  }

  if (sentenceStart < len) {
    pushTrimmedSpan(sentenceSpans, text, sentenceStart, len);
  }

  const finalChunks: TextChunkSpan[] = [];
  for (const span of sentenceSpans) {
    if (span.text.length <= maxChunkLength) {
      finalChunks.push(span);
    } else {
      finalChunks.push(
        ...splitLongSpanWithOffsets(
          text,
          span.charStart,
          span.charEnd,
          maxChunkLength,
        ),
      );
    }
  }

  return finalChunks;
}

/**
 * Builds word-level timestamps for a synthesized TTS chunk using character-proportional
 * chunk duration alignment as described in https://ryanwelch.co.uk/blog/kokoro-word-timestamps/.
 */
export function buildWordAlignmentData(
  text: string,
  chunkDurationSeconds: number,
  chunkOffsetSeconds: number,
  options: {
    chunkCharStart?: number;
    chunkIndex?: number;
    startingWordIndex?: number;
  } = {},
): WordTimestamp[] {
  const {
    chunkCharStart = 0,
    chunkIndex = 0,
    startingWordIndex = 0,
  } = options;

  const chars = Array.from(text);
  const charDuration =
    chars.length > 0 ? chunkDurationSeconds / chars.length : 0;
  const words: WordTimestamp[] = [];

  let currentText = "";
  let currentStartMs: number | null = null;
  let currentEndMs: number | null = null;
  let currentCharStart: number | null = null;
  let utf16Offset = chunkCharStart;
  let nextWordIndex = startingWordIndex;

  chars.forEach((char, index) => {
    const startSeconds = chunkOffsetSeconds + index * charDuration;
    const endSeconds = startSeconds + charDuration;
    const startMs = Math.round(startSeconds * 1000);
    const endMs = Math.round(endSeconds * 1000);

    if (/\s/.test(char)) {
      if (currentText) {
        words.push({
          text: currentText,
          startMs: currentStartMs!,
          endMs: currentEndMs!,
          charStart: currentCharStart!,
          charEnd: utf16Offset,
          chunkIndex,
          wordIndex: nextWordIndex++,
        });
        currentText = "";
        currentStartMs = null;
        currentEndMs = null;
        currentCharStart = null;
      }
      utf16Offset += char.length;
      return;
    }

    if (currentStartMs === null) {
      currentStartMs = startMs;
      currentCharStart = utf16Offset;
    }

    currentText += char;
    currentEndMs = endMs;
    utf16Offset += char.length;
  });

  if (currentText) {
    words.push({
      text: currentText,
      startMs: currentStartMs!,
      endMs: currentEndMs!,
      charStart: currentCharStart!,
      charEnd: utf16Offset,
      chunkIndex,
      wordIndex: nextWordIndex,
    });
  }

  return words;
}

const IPA_MODIFIER_SYMBOLS = new Set([
  "ˈ",
  "ˌ",
  "ː",
  "ʰ",
  "ʲ",
  "̃",
  "ᵝ",
  "ᵊ",
  "↓",
  "→",
  "↗",
  "↘",
]);

const TOKEN_PUNCTUATION_SYMBOLS = new Set([
  ";",
  ":",
  ",",
  ".",
  "!",
  "?",
  "¡",
  "¿",
  "—",
  "…",
  '"',
  "«",
  "»",
  "“",
  "”",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "।",
  "॥",
  "$",
]);

const CLAUSE_PUNCTUATION_SYMBOLS = new Set([
  ";",
  ":",
  ",",
  ".",
  "!",
  "?",
  "¡",
  "¿",
  "—",
  "…",
  "।",
  "॥",
]);

function roundHalfToEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

type PhoneticFeatureClass = "V" | "N" | "L" | "F" | "S";

function classifyIpaSymbol(sym: string): PhoneticFeatureClass {
  if ("ɑɐɒæɔəɚɛɜɪɨɯøœɶʊʌaeiouyᵻɤAIOQWY".includes(sym)) return "V";
  if ("mnŋɳɲɴ".includes(sym)) return "N";
  if ("lɹɾɻʁɽʎwɥjɰrT".includes(sym)) return "L";
  if ("fvθðszʃʒɕʑçʝxɣχħʕhɦβɸʂS".includes(sym)) return "F";
  return "S";
}

const NUMBER_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const NUMBER_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function numberToSubwords(numStr: string): string[] {
  if (numStr.length > 12) {
    return numStr
      .split("")
      .map((digit) => (digit === "0" ? "zero" : NUMBER_ONES[Number(digit)] || digit));
  }
  const n = parseInt(numStr, 10);
  if (Number.isNaN(n)) return [numStr];
  if (n === 0) return ["zero"];

  const out: string[] = [];
  let rem = n;
  if (rem >= 1_000_000_000) {
    out.push(
      ...numberToSubwords(String(Math.floor(rem / 1_000_000_000))),
      "billion",
    );
    rem %= 1_000_000_000;
  }
  if (rem >= 1_000_000) {
    out.push(...numberToSubwords(String(Math.floor(rem / 1_000_000))), "million");
    rem %= 1_000_000;
  }
  if (rem >= 1000) {
    out.push(...numberToSubwords(String(Math.floor(rem / 1000))), "thousand");
    rem %= 1000;
  }
  if (rem >= 100) {
    out.push(NUMBER_ONES[Math.floor(rem / 100)], "hundred");
    rem %= 100;
  }
  if (rem >= 20) {
    out.push(NUMBER_TENS[Math.floor(rem / 10)]);
    if (rem % 10 > 0) out.push(NUMBER_ONES[rem % 10]);
  } else if (rem > 0) {
    out.push(NUMBER_ONES[rem]);
  }
  return out;
}

function wordToPhoneticClasses(subword: string): PhoneticFeatureClass[] {
  let clean = subword
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!clean) return ["V"];

  if (/^\d+(?:st|nd|rd|th)?$/.test(clean)) {
    if (clean === "1st") clean = "first";
    else if (clean === "2nd") clean = "second";
    else if (clean === "3rd") clean = "third";
    else if (clean === "5th") clean = "fifth";
    else {
      const hasOrdinal = /(?:st|nd|rd|th)$/.test(clean);
      const digits = clean.replace(/(?:st|nd|rd|th)$/, "");
      clean = numberToSubwords(digits).join("") + (hasOrdinal ? "th" : "");
    }
  }

  if (clean === "one") clean = "wan";
  else if (clean === "once") clean = "wans";
  else if (clean.startsWith("who")) clean = `h${clean.slice(2)}`;
  else if (/^(?:kn|gn|pn|ps|wr)/.test(clean)) clean = clean.slice(1);

  const classes: PhoneticFeatureClass[] = [];
  const pushClass = (cls: PhoneticFeatureClass) => {
    if (classes.at(-1) !== cls) classes.push(cls);
  };

  let i = 0;
  while (i < clean.length) {
    const two = clean.slice(i, i + 2);
    if (two === "th" || two === "sh" || two === "ph" || two === "gh") {
      pushClass("F");
      i += 2;
      continue;
    }
    if (two === "wh") {
      pushClass("L");
      i += 2;
      continue;
    }
    if (two === "ch" || two === "ck" || two === "dg") {
      pushClass("S");
      i += 2;
      continue;
    }
    if (two === "ng") {
      pushClass("N");
      i += 2;
      continue;
    }
    if (two === "qu") {
      pushClass("S");
      pushClass("L");
      i += 2;
      continue;
    }

    const c = clean[i];
    if (c === "x") {
      pushClass("S");
      pushClass("F");
      i++;
      continue;
    }
    if ("aeiouy".includes(c)) {
      if (
        c === "e" &&
        i === clean.length - 1 &&
        classes.includes("V") &&
        clean.length > 2
      ) {
        i++;
        continue;
      }
      pushClass("V");
    } else if ("mn".includes(c)) {
      pushClass("N");
    } else if ("lrwj".includes(c)) {
      pushClass("L");
    } else if ("fvszh".includes(c)) {
      pushClass("F");
    } else {
      pushClass("S");
    }
    i++;
  }

  return classes.length > 0 ? classes : ["V"];
}

function phoneticFeatureDistance(
  expected: readonly PhoneticFeatureClass[],
  observed: readonly PhoneticFeatureClass[],
): number {
  const m = expected.length;
  const n = observed.length;
  let prev = new Float64Array(n + 1);
  let curr = new Float64Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j * 0.9;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i * 0.9;
    for (let j = 1; j <= n; j++) {
      const subCost = expected[i - 1] === observed[j - 1] ? 0 : 1.1;
      const del = prev[j] + 0.9;
      const ins = curr[j - 1] + 0.9;
      const sub = prev[j - 1] + subCost;
      curr[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

function expandSourceWordsForDurations(wordSegs: readonly TextSegment[]): string[][] {
  return wordSegs.map((seg, idx) => {
    const nextSeg = wordSegs[idx + 1];
    const probe = nextSeg ? `${seg.text} ${nextSeg.text}` : seg.text;
    const normProbe = normalizeText(probe);
    const normNext = nextSeg ? normalizeText(nextSeg.text) : "";
    let normWord = seg.text;

    if (nextSeg && normNext && normProbe.endsWith(` ${normNext}`)) {
      normWord = normProbe.slice(0, normProbe.length - normNext.length - 1);
    } else {
      normWord = normalizeText(seg.text);
    }

    const rawParts = normWord.split(/\s+/).filter(Boolean);
    const subwords: string[] = [];
    for (const part of rawParts) {
      const stripped = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (/^\d+$/.test(stripped)) {
        subwords.push(...numberToSubwords(stripped));
      } else if (
        stripped.includes("-") &&
        stripped.split("-").every((piece) => piece.length <= 1)
      ) {
        subwords.push(stripped.replace(/-/g, ""));
      } else if (stripped.length > 0) {
        subwords.push(stripped);
      } else {
        subwords.push(part);
      }
    }

    return subwords.length > 0 ? subwords : [seg.text];
  });
}

/**
 * Computes exact word-level timestamps directly from native per-token `durations` output tensors
 * (`Kokoro-82M-v1.0-ONNX-timestamped` `durations` or `Paradee-8M-v1.3` `/Clip_output_0`) and
 * decoded IPA/punctuation `tokens`.
 *
 * Each integer frame in `roundHalfToEven(durations[i])` spans 600 waveform samples (25ms at 24 kHz)
 * across all speeds, including BOS/EOS leading/trailing silence (`tokens[0] === "$"`, `tokens[N-1] === "$"`),
 * punctuation pauses, and individual phoneme durations. When `options.wordTokenSpans` is supplied
 * (from per-word G2P such as Paradee's Hindi/French/Spanish G2P), each word reads its exact
 * `[firstTokenIndex, lastTokenIndex]` token range directly; otherwise source words are aligned
 * monotonically to spoken phoneme tokens via phonetic-feature dynamic programming.
 */
export function buildDurationWordAlignmentData(
  text: string,
  tokens: readonly string[],
  durations: ArrayLike<number>,
  totalSamples: number,
  sampleRate: number,
  offsetSeconds = 0,
  options: {
    chunkCharStart?: number;
    chunkIndex?: number;
    startingWordIndex?: number;
  } = {},
): WordTimestamp[] {
  const {
    chunkCharStart = 0,
    chunkIndex = 0,
    startingWordIndex = 0,
  } = options;

  if (!text) return [];

  const fallback = (): WordTimestamp[] =>
    buildWordAlignmentData(
      text,
      sampleRate > 0 ? totalSamples / sampleRate : 0,
      offsetSeconds,
      { chunkCharStart, chunkIndex, startingWordIndex },
    );

  if (
    sampleRate <= 0 ||
    totalSamples <= 0 ||
    tokens.length < 2 ||
    durations.length !== tokens.length
  ) {
    return fallback();
  }

  const { segments } = segmentTextIntoWords(text);
  const wordSegs = segments.filter((seg) => seg.type === "word");
  if (wordSegs.length === 0) return [];

  const tokenCount = tokens.length;
  const roundedUnits = new Float64Array(tokenCount);
  let sumRounded = 0;
  for (let i = 0; i < tokenCount; i++) {
    const v = Math.max(0, roundHalfToEven(Number(durations[i]) || 0));
    roundedUnits[i] = v;
    sumRounded += v;
  }

  let units = roundedUnits;
  let totalUnits = sumRounded;
  if (totalUnits <= 0) {
    const rawUnits = new Float64Array(tokenCount);
    let sumRaw = 0;
    for (let i = 0; i < tokenCount; i++) {
      const v = Math.max(0, Number(durations[i]) || 0);
      rawUnits[i] = v;
      sumRaw += v;
    }
    if (sumRaw <= 0) return fallback();
    units = rawUnits;
    totalUnits = sumRaw;
  }

  const chunkDurationSec = totalSamples / sampleRate;
  const secPerUnit = chunkDurationSec / totalUnits;
  const tokStartSec = new Float64Array(tokenCount);
  const tokEndSec = new Float64Array(tokenCount);
  let accSec = 0;
  for (let i = 0; i < tokenCount; i++) {
    tokStartSec[i] = accSec;
    accSec += units[i] * secPerUnit;
    tokEndSec[i] = accSec;
  }

  const startTokIdx = tokens[0] === "$" ? 1 : 0;
  const endTokIdx =
    tokens[tokenCount - 1] === "$" ? tokenCount - 1 : tokenCount;

  interface PhonemeTokenEntry {
    tokIdx: number;
    cls: PhoneticFeatureClass | null;
    hadSep: boolean;
    hadClausePunct: boolean;
  }

  const phonToks: PhonemeTokenEntry[] = [];
  for (let i = startTokIdx; i < endTokIdx; i++) {
    const sym = tokens[i];
    if (!sym || sym === " " || TOKEN_PUNCTUATION_SYMBOLS.has(sym)) {
      continue;
    }
    let hadSep = phonToks.length === 0;
    let hadClausePunct = false;
    if (phonToks.length > 0) {
      const prevIdx = phonToks[phonToks.length - 1].tokIdx;
      for (let k = prevIdx + 1; k < i; k++) {
        const sepSym = tokens[k];
        if (sepSym === " " || TOKEN_PUNCTUATION_SYMBOLS.has(sepSym)) {
          hadSep = true;
        }
        if (CLAUSE_PUNCTUATION_SYMBOLS.has(sepSym)) {
          hadClausePunct = true;
        }
      }
    }
    phonToks.push({
      tokIdx: i,
      cls: IPA_MODIFIER_SYMBOLS.has(sym) ? null : classifyIpaSymbol(sym),
      hadSep,
      hadClausePunct,
    });
  }

  const wordFirstTokIdx = new Int32Array(wordSegs.length).fill(-1);
  const wordLastTokIdx = new Int32Array(wordSegs.length).fill(-1);

  {
    if (phonToks.length === 0) {
      return fallback();
    }

    interface AlignmentSubUnit {
      wordIdx: number;
      classes: PhoneticFeatureClass[];
      hasPunctAfter: boolean;
      isSilentPunct: boolean;
    }

    const expandedPerWord = expandSourceWordsForDurations(wordSegs);
    const subUnits: AlignmentSubUnit[] = [];
    expandedPerWord.forEach((subs, wordIdx) => {
      const rawWord = wordSegs[wordIdx].text;
      const trailingSlice = rawWord.slice(-2);
      subs.forEach((sw, subIdx) => {
        const isSilentPunct =
          !/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(sw);
        const hasPunctAfter =
          subIdx === subs.length - 1 && /[,.;:!?¡¿—…।॥]/.test(trailingSlice);
        subUnits.push({
          wordIdx,
          classes: wordToPhoneticClasses(sw),
          hasPunctAfter,
          isSilentPunct,
        });
      });
    });

    const U = subUnits.length;
    const P = phonToks.length;
    const INF = 1e12;
    const dp = Array.from({ length: U + 1 }, () =>
      new Float64Array(P + 1).fill(INF),
    );
    const parent = Array.from({ length: U + 1 }, () =>
      new Int32Array(P + 1).fill(-1),
    );
    dp[0][0] = 0;

    const strideLimit = Math.max(40, Math.ceil((P / Math.max(1, U)) * 4));

    for (let u = 0; u < U; u++) {
      const unit = subUnits[u];
      const skipCost = unit.isSilentPunct ? 0.5 : 30.0;

      for (let p = 0; p <= P; p++) {
        const baseCost = dp[u][p];
        if (baseCost >= INF / 2) continue;

        if (baseCost + skipCost < dp[u + 1][p]) {
          dp[u + 1][p] = baseCost + skipCost;
          parent[u + 1][p] = p;
        }

        if (p >= P) continue;

        const boundaryCost = u > 0 ? (phonToks[p].hadSep ? 0 : 3.2) : 0;
        const maxQ = u === U - 1 ? P : Math.min(P, p + strideLimit);
        const observedClasses: PhoneticFeatureClass[] = [];
        let internalSeparators = 0;

        for (let q = p + 1; q <= maxQ; q++) {
          const pt = phonToks[q - 1];
          if (q > p + 1) {
            if (pt.hadSep) internalSeparators += 1;
            if (pt.hadClausePunct) internalSeparators += 3;
          }
          if (pt.cls && observedClasses.at(-1) !== pt.cls) {
            observedClasses.push(pt.cls);
          }

          let punctMismatchCost = 0;
          if (q < P) {
            const nextHasPunct = phonToks[q].hadClausePunct;
            if (unit.hasPunctAfter !== nextHasPunct) {
              punctMismatchCost = 2.5;
            }
          }

          const internalCost = internalSeparators * 6.0;
          const dist = phoneticFeatureDistance(unit.classes, observedClasses);
          const candidateCost =
            baseCost + boundaryCost + internalCost + punctMismatchCost + dist;

          if (candidateCost < dp[u + 1][q]) {
            dp[u + 1][q] = candidateCost;
            parent[u + 1][q] = p;
          }
        }
      }
    }

    if (dp[U][P] >= INF / 2) {
      return fallback();
    }

    const subSpans: Array<[number, number]> = new Array(U);
    let cursor = P;
    for (let u = U; u >= 1; u--) {
      const prev = parent[u][cursor];
      const safePrev = prev >= 0 ? prev : cursor;
      subSpans[u - 1] = [safePrev, cursor];
      cursor = safePrev;
    }

    for (let u = 0; u < U; u++) {
      const wIdx = subUnits[u].wordIdx;
      const [a, b] = subSpans[u];
      if (b > a) {
        const firstIdx = phonToks[a].tokIdx;
        const lastIdx = phonToks[b - 1].tokIdx;
        if (wordFirstTokIdx[wIdx] === -1 || firstIdx < wordFirstTokIdx[wIdx]) {
          wordFirstTokIdx[wIdx] = firstIdx;
        }
        if (lastIdx > wordLastTokIdx[wIdx]) {
          wordLastTokIdx[wIdx] = lastIdx;
        }
      }
    }
  }

  const wordStartSec = new Float64Array(wordSegs.length);
  const wordEndSec = new Float64Array(wordSegs.length);

  for (let w = 0; w < wordSegs.length; w++) {
    if (wordFirstTokIdx[w] !== -1 && wordLastTokIdx[w] !== -1) {
      wordStartSec[w] = tokStartSec[wordFirstTokIdx[w]];
      wordEndSec[w] = tokEndSec[wordLastTokIdx[w]];
    }
  }

  // Resolve any unvoiced / standalone-punctuation words (e.g. "—") using interstitial tokens
  for (let w = 0; w < wordSegs.length; w++) {
    if (wordFirstTokIdx[w] !== -1) continue;

    let prevWord = w - 1;
    while (prevWord >= 0 && wordLastTokIdx[prevWord] === -1) prevWord--;
    let nextWord = w + 1;
    while (nextWord < wordSegs.length && wordFirstTokIdx[nextWord] === -1) {
      nextWord++;
    }

    const searchStart =
      prevWord >= 0 ? wordLastTokIdx[prevWord] + 1 : startTokIdx;
    const searchEnd =
      nextWord < wordSegs.length ? wordFirstTokIdx[nextWord] : endTokIdx;

    let matchedPunctIdx = -1;
    for (let k = searchStart; k < searchEnd; k++) {
      if (
        TOKEN_PUNCTUATION_SYMBOLS.has(tokens[k]) &&
        tokens[k] !== "$"
      ) {
        matchedPunctIdx = k;
        break;
      }
    }

    if (matchedPunctIdx !== -1) {
      wordStartSec[w] = tokStartSec[matchedPunctIdx];
      wordEndSec[w] = tokEndSec[matchedPunctIdx];
    } else {
      const fallbackLeftIdx =
        phonToks.length > 0
          ? phonToks[0].tokIdx
          : Math.min(startTokIdx, tokenCount - 1);
      const fallbackRightIdx =
        phonToks.length > 0
          ? phonToks[phonToks.length - 1].tokIdx
          : Math.max(0, Math.min(endTokIdx - 1, tokenCount - 1));
      const leftSec =
        prevWord >= 0 ? wordEndSec[prevWord] : tokStartSec[fallbackLeftIdx];
      const rightSec =
        nextWord < wordSegs.length
          ? wordStartSec[nextWord]
          : tokEndSec[fallbackRightIdx];
      const midSec = (leftSec + rightSec) * 0.5;
      wordStartSec[w] = midSec;
      wordEndSec[w] = midSec;
    }
  }

  const result: WordTimestamp[] = [];
  let prevEndMs = Math.round(offsetSeconds * 1000);

  for (let w = 0; w < wordSegs.length; w++) {
    const seg = wordSegs[w];
    const startMs = Math.max(
      prevEndMs,
      Math.round((offsetSeconds + wordStartSec[w]) * 1000),
    );
    const endMs = Math.max(
      startMs,
      Math.round((offsetSeconds + wordEndSec[w]) * 1000),
    );
    prevEndMs = endMs;

    result.push({
      text: seg.text,
      startMs,
      endMs,
      charStart: chunkCharStart + seg.charStart,
      charEnd: chunkCharStart + seg.charEnd,
      chunkIndex,
      wordIndex: startingWordIndex + w,
    });
  }

  return result;
}

/**
 * Builds a `ChunkAlignment` for one synthesized chunk. Word times come from
 * the model's per-token `durations` when they match `tokens`; otherwise
 * `buildDurationWordAlignmentData` falls back to character-proportional
 * timing across the chunk.
 */
export function buildChunkAlignment(params: {
  chunkIndex: number;
  span: TextChunkSpan;
  tokens?: readonly string[];
  durations?: ArrayLike<number>;
  chunkSamples: number;
  totalSamplesBeforeChunk: number;
  sampleRate: number;
  startingWordIndex: number;
}): ChunkAlignment {
  const {
    chunkIndex,
    span,
    tokens = [],
    durations = [],
    chunkSamples,
    totalSamplesBeforeChunk,
    sampleRate,
    startingWordIndex,
  } = params;

  const chunkDurationSeconds = sampleRate > 0 ? chunkSamples / sampleRate : 0;
  const chunkOffsetSeconds =
    sampleRate > 0 ? totalSamplesBeforeChunk / sampleRate : 0;
  const startMs = Math.round(chunkOffsetSeconds * 1000);
  const endMs = Math.round((chunkOffsetSeconds + chunkDurationSeconds) * 1000);

  return {
    chunkIndex,
    text: span.text,
    charStart: span.charStart,
    charEnd: span.charEnd,
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    words: buildDurationWordAlignmentData(
      span.text,
      tokens,
      durations,
      chunkSamples,
      sampleRate,
      chunkOffsetSeconds,
      { chunkCharStart: span.charStart, chunkIndex, startingWordIndex },
    ),
  };
}
