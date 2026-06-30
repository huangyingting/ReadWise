/**
 * ReadWise speech timing — types, tokenisation, and audio-time helpers.
 *
 * Runtime speech timings are normalized audio/text cues. New stored JSON uses a
 * single V2 payload: compact columnar arrays with provider/top-level metadata.
 * Legacy raw arrays are still accepted as read-only compatibility input and can
 * be converted to V2 with `legacySpeechWordsToTimingPayloadV2`.
 */

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
};

export type SpeechTimingPayloadV2 = SpeechTimingPayloadBase & {
  version: 2;
  words: string[];
  startMs: number[];
  endMs: number[];
  textStart?: number[];
  textEnd?: number[];
};

export type SpeechTimingPayload = SpeechTimingPayloadV2;

export type WordTiming = {
  word: string;
  startMs: number;
  endMs: number;
  textStart?: number;
  textEnd?: number;
};

export type SpeechWord = WordTiming;

export type ParsedSpeechTimingPayload = SpeechTimingPayloadBase & {
  version: 2;
  words: SpeechWord[];
};

export type TextToken = {
  start: number;
  end: number;
  value: string;
  normalized: string;
};

export type ComparableToken = Pick<TextToken, "value" | "normalized">;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

  const textStart = record.textStart === undefined ? undefined : parseNumberArray(record.textStart);
  const textEnd = record.textEnd === undefined ? undefined : parseNumberArray(record.textEnd);
  const hasTextSpans = textStart !== undefined || textEnd !== undefined;
  if (
    (record.textStart !== undefined && !textStart) ||
    (record.textEnd !== undefined && !textEnd) ||
    (hasTextSpans && (!textStart || !textEnd)) ||
    (textStart && textStart.length !== words.length) ||
    (textEnd && textEnd.length !== words.length)
  ) {
    return null;
  }

  const normalized: SpeechWord[] = [];
  for (let index = 0; index < words.length; index++) {
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
    normalized.push(word);
  }

  return {
    version: 2,
    provider,
    timeUnit: "ms",
    textUnit: "utf16",
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
): SpeechTimingPayloadV2 {
  const includeTextSpans = words.length > 0 && words.every(
    (word) =>
      finiteNumber(word.textStart) &&
      finiteNumber(word.textEnd) &&
      word.textStart >= 0 &&
      word.textEnd > word.textStart,
  );

  const payload: SpeechTimingPayloadV2 = {
    version: 2,
    provider,
    timeUnit: "ms",
    textUnit: "utf16",
    words: words.map((word) => word.word),
    startMs: words.map((word) => word.startMs),
    endMs: words.map((word) => word.endMs),
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

const LETTER_CONNECTOR_CLASS = "[-'ʼʻ‛′’‐‑]";
const NUMBER_RANGE_CONNECTOR_CLASS = "[-‐‑‒–—−]";
const NUMBER_INNER_SEPARATOR_CLASS = "[:/∶]";
const DIGIT_GROUP = "[0-9]+(?:,[0-9]{3})*(?:[.][0-9]+)?";
const NUMBER_CORE = `(?:[$])?${DIGIT_GROUP}(?:${NUMBER_INNER_SEPARATOR_CLASS}${DIGIT_GROUP})*%?`;
const NUMBER_PATTERN = `${NUMBER_CORE}(?:${NUMBER_RANGE_CONNECTOR_CLASS}${NUMBER_CORE})*`;
const ORDINAL_PATTERN = "[0-9]+(?:st|nd|rd|th)";
const SPEECH_PUNCTUATION_PATTERN = /[^\sA-Za-z0-9]/.source;

export const WORD_PATTERN =
  `([A-Za-z](?:[.][A-Za-z])+[.]?|${ORDINAL_PATTERN}|${NUMBER_PATTERN}|[A-Za-z0-9]+(?:${LETTER_CONNECTOR_CLASS}[A-Za-z0-9]+)*)`;
export const SPEECH_BOUNDARY_PATTERN = `${WORD_PATTERN}|(${SPEECH_PUNCTUATION_PATTERN})`;

export function createWordRegex(): RegExp {
  return new RegExp(WORD_PATTERN, "g");
}

export function createSpeechBoundaryRegex(): RegExp {
  return new RegExp(SPEECH_BOUNDARY_PATTERN, "g");
}

export function createComparableKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const alphanumeric = createAlphanumericKey(trimmed);
  return alphanumeric || trimmed.toLowerCase();
}

export function createAlphanumericKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractTextTokens(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const regex = createWordRegex();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    tokens.push({
      start,
      end,
      value,
      normalized: createComparableKey(value),
    });
  }

  return tokens;
}

export function extractSpeechBoundaryTokens(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const regex = createSpeechBoundaryRegex();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    const start = match.index ?? 0;
    const end = start + value.length;
    tokens.push({
      start,
      end,
      value,
      normalized: createComparableKey(value),
    });
  }

  return tokens;
}

function millisecondsToSeconds(milliseconds: number): number {
  return milliseconds / 1000;
}

export function timingStartSeconds(timing: WordTiming): number {
  return millisecondsToSeconds(timing.startMs);
}

export function timingEndSeconds(timing: WordTiming): number {
  return millisecondsToSeconds(timing.endMs);
}
