/**
 * ReadWise speech timing — types, tokenisation, and audio-time helpers.
 *
 * Runtime speech timings are audio-time boundaries. New Azure rows also include
 * textOffset/wordLength against the synthesized plainText so the reader can
 * anchor highlights directly and avoid sequence alignment.
 */

export type WordTiming = {
  word: string;
  offset: number;
  duration: number;
  textOffset?: number;
  wordLength?: number;
};

export type SpeechWord = WordTiming;

export type TextToken = {
  start: number;
  end: number;
  value: string;
  normalized: string;
};

export type ComparableToken = Pick<TextToken, "value" | "normalized">;

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
  return millisecondsToSeconds(timing.offset);
}

export function timingEndSeconds(timing: WordTiming): number {
  return millisecondsToSeconds(timing.offset + timing.duration);
}
