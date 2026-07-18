/**
 * Stored speech timing payloads.
 *
 * Legacy arrays, compact V1, and canonical V2 all normalize to runtime
 * SpeechWord values. Production writes remain V2; V1 is migration-only.
 */

import type { NarrationTextBasis } from "./text-basis";
import type { SpeechWord } from "./timing";

export type SpeechTimingProvider =
  | "azure"
  | "polly"
  | "elevenlabs"
  | "cartesia"
  | "unknown";

export type SpeechTimingPayloadBase = {
  provider: SpeechTimingProvider | string;
  timeUnit: "ms";
  textUnit: "utf16";
  textBasis?: NarrationTextBasis;
};

export type SpeechTimingPayloadV2 = SpeechTimingPayloadBase & {
  version: 2;
  words: string[];
  startMs: number[];
  endMs: number[];
  textStart?: number[];
  textEnd?: number[];
};

export type SpeechTimingPayloadV1 = {
  version: 1;
  words: string[];
  startMs: number[];
  endMs: number[];
};

export type SpeechTimingPayload = SpeechTimingPayloadV1 | SpeechTimingPayloadV2;

export type ParsedSpeechTimingPayload = SpeechTimingPayloadBase & {
  version: 2;
  words: SpeechWord[];
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasCompleteTextSpan(word: Pick<SpeechWord, "textStart" | "textEnd">): boolean {
  return (
    finiteNumber(word.textStart) &&
    finiteNumber(word.textEnd) &&
    word.textStart >= 0 &&
    word.textEnd > word.textStart
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLegacyWord(raw: unknown): SpeechWord | null {
  if (!isRecord(raw)) return null;
  const { word, offset, duration, textOffset, wordLength } = raw;
  if (
    typeof word !== "string" ||
    !word.trim() ||
    !finiteNumber(offset) ||
    !finiteNumber(duration) ||
    offset < 0 ||
    duration < 0
  ) {
    return null;
  }

  const result: SpeechWord = {
    word,
    startMs: offset,
    endMs: offset + duration,
  };

  const hasTextSpan = textOffset !== undefined || wordLength !== undefined;
  if (!hasTextSpan) return result;
  if (
    !finiteNumber(textOffset) ||
    !finiteNumber(wordLength) ||
    textOffset < 0 ||
    wordLength <= 0
  ) {
    return null;
  }
  result.textStart = textOffset;
  result.textEnd = textOffset + wordLength;
  return result;
}

function parseLegacyWords(rawWords: unknown): SpeechWord[] | null {
  if (!Array.isArray(rawWords)) return null;
  const words: SpeechWord[] = [];
  for (const rawWord of rawWords) {
    const word = normalizeLegacyWord(rawWord);
    if (!word) return null;
    words.push(word);
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

function parseStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value
    : null;
}

function parseNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => finiteNumber(item) && item >= 0)
    ? value
    : null;
}

function parseNarrationTextBasis(value: unknown): NarrationTextBasis | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "full") return { kind: "full" };
  if (
    (value.kind === "character-limit" || value.kind === "paragraph-limit") &&
    Number.isSafeInteger(value.maxChars) &&
    (value.maxChars as number) > 0
  ) {
    return { kind: value.kind, maxChars: value.maxChars as number };
  }
  return null;
}

type ParsedTextSpanColumns = {
  textStart?: number[];
  textEnd?: number[];
};

function parseTextSpanColumns(
  record: Record<string, unknown>,
  expectedLength: number,
): ParsedTextSpanColumns | null {
  const textStart = record.textStart === undefined ? undefined : parseNumberArray(record.textStart);
  const textEnd = record.textEnd === undefined ? undefined : parseNumberArray(record.textEnd);
  const hasTextSpans = textStart !== undefined || textEnd !== undefined;

  if (
    (record.textStart !== undefined && !textStart) ||
    (record.textEnd !== undefined && !textEnd) ||
    (hasTextSpans && (!textStart || !textEnd)) ||
    (textStart && textStart.length !== expectedLength) ||
    (textEnd && textEnd.length !== expectedLength)
  ) {
    return null;
  }

  return { textStart, textEnd };
}

function speechWordFromColumns(params: {
  words: string[];
  startMs: number[];
  endMs: number[];
  textStart?: number[];
  textEnd?: number[];
  index: number;
}): SpeechWord | null {
  const { words, startMs, endMs, textStart, textEnd, index } = params;
  const start = startMs[index];
  const end = endMs[index];
  if (start == null || end == null || end < start) return null;

  const word: SpeechWord = {
    word: words[index] ?? "",
    startMs: start,
    endMs: end,
  };

  if (textStart && textEnd) {
    const startText = textStart[index];
    const endText = textEnd[index];
    if (startText == null || endText == null || endText <= startText) return null;
    word.textStart = startText;
    word.textEnd = endText;
  }

  return word;
}

function parseV1Payload(record: Record<string, unknown>): ParsedSpeechTimingPayload | null {
  const words = parseStringArray(record.words);
  const startMs = parseNumberArray(record.startMs);
  const endMs = parseNumberArray(record.endMs);

  if (
    !words ||
    !startMs ||
    !endMs ||
    startMs.length !== words.length ||
    endMs.length !== words.length
  ) {
    return null;
  }

  const normalized: SpeechWord[] = [];
  for (let index = 0; index < words.length; index++) {
    const start = startMs[index];
    const end = endMs[index];
    if (start == null || end == null || end < start) return null;
    normalized.push({ word: words[index] ?? "", startMs: start, endMs: end });
  }

  return {
    version: 2,
    provider: "unknown",
    timeUnit: "ms",
    textUnit: "utf16",
    words: normalized,
  };
}

function parseV2Payload(record: Record<string, unknown>): ParsedSpeechTimingPayload | null {
  const words = parseStringArray(record.words);
  const startMs = parseNumberArray(record.startMs);
  const endMs = parseNumberArray(record.endMs);
  const provider = record.provider;
  if (
    !words ||
    !startMs ||
    !endMs ||
    typeof provider !== "string" ||
    provider.trim() === "" ||
    record.timeUnit !== "ms" ||
    record.textUnit !== "utf16" ||
    startMs.length !== words.length ||
    endMs.length !== words.length
  ) {
    return null;
  }

  const textSpans = parseTextSpanColumns(record, words.length);
  if (!textSpans) return null;
  const textBasis = record.textBasis === undefined
    ? undefined
    : parseNarrationTextBasis(record.textBasis);
  if (record.textBasis !== undefined && !textBasis) return null;

  const normalized: SpeechWord[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = speechWordFromColumns({
      words,
      startMs,
      endMs,
      ...textSpans,
      index,
    });
    if (!word) return null;
    normalized.push(word);
  }

  return {
    version: 2,
    provider,
    timeUnit: "ms",
    textUnit: "utf16",
    ...(textBasis ? { textBasis } : {}),
    words: normalized,
  };
}

export function parseSpeechTimingPayload(raw: unknown): ParsedSpeechTimingPayload | null {
  if (Array.isArray(raw)) {
    const words = parseLegacyWords(raw);
    return words
      ? {
          version: 2,
          provider: "unknown",
          timeUnit: "ms",
          textUnit: "utf16",
          words,
        }
      : null;
  }

  if (!isRecord(raw)) return null;

  // Compact V1 has no provider/timeUnit/textUnit — handle before the V2 gate.
  if (raw.version === 1) {
    return parseV1Payload(raw);
  }

  const { version, provider, timeUnit, textUnit } = raw;
  if (
    typeof provider !== "string" ||
    provider.trim() === "" ||
    timeUnit !== "ms" ||
    textUnit !== "utf16"
  ) {
    return null;
  }

  if (version === 2) {
    return parseV2Payload(raw);
  }

  return null;
}

export function createSpeechTimingPayloadV2(
  provider: SpeechTimingProvider | string,
  words: SpeechWord[],
  textBasis?: NarrationTextBasis,
): SpeechTimingPayloadV2 {
  const includeTextSpans = words.length > 0 && words.every(hasCompleteTextSpan);

  const payload: SpeechTimingPayloadV2 = {
    version: 2,
    provider,
    timeUnit: "ms",
    textUnit: "utf16",
    words: words.map((word) => word.word),
    startMs: words.map((word) => word.startMs),
    endMs: words.map((word) => word.endMs),
    ...(textBasis ? { textBasis } : {}),
  };

  if (includeTextSpans) {
    payload.textStart = words.map((word) => word.textStart ?? 0);
    payload.textEnd = words.map((word) => word.textEnd ?? 0);
  }

  return payload;
}

export function legacySpeechWordsToTimingPayloadV2(
  raw: unknown,
  provider: SpeechTimingProvider | string = "unknown",
): SpeechTimingPayloadV2 | null {
  const words = parseLegacyWords(raw);
  return words ? createSpeechTimingPayloadV2(provider, words) : null;
}

export function createSpeechTimingPayloadV1(words: SpeechWord[]): SpeechTimingPayloadV1 {
  return {
    version: 1,
    words: words.map((w) => w.word),
    startMs: words.map((w) => w.startMs),
    endMs: words.map((w) => w.endMs),
  };
}

export function legacySpeechWordsToTimingPayloadV1(raw: unknown): SpeechTimingPayloadV1 | null {
  const words = parseLegacyWords(raw);
  return words ? createSpeechTimingPayloadV1(words) : null;
}
