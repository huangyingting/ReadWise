/**
 * Shared speech-practice helpers for dictation and pronunciation tools.
 *
 * These functions operate on plain article text plus TTS word timings and are
 * intentionally pure so UI components do not each re-implement sentence
 * segmentation and audio-range alignment.
 */
import {
  buildTokenAlignment,
  extractTextTokens,
  timingEndSeconds,
  timingStartSeconds,
  type TextToken,
  type WordTiming,
} from "@/lib/speech-timing";

const DEFAULT_MIN_WORDS = 3;
const DEFAULT_MAX_CHARS = 300;

export type PracticeSentenceOptions = {
  minWords?: number;
  maxChars?: number;
};

export type SpeechPracticeSegment = {
  text: string;
  startTime: number;
  endTime: number;
};

/**
 * Splits article plain text into practisable sentence strings.
 *
 * The returned sentences are exact substrings of the normalized paragraph text
 * used by the existing Reader tools. This preserves the previous dictation and
 * pronunciation constraints: skip very short/long sentences and avoid common
 * abbreviation/decimal false boundaries.
 */
export function splitPracticeSentences(
  plainText: string,
  opts: PracticeSentenceOptions = {},
): string[] {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const results: string[] = [];
  const paragraphs = plainText.split(/\n{2,}/);

  for (const para of paragraphs) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;

    let cursor = 0;
    const re = /[.!?]+\s+(?=[A-Z"'])/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(p)) !== null) {
      const punctLen = (m[0].match(/^[.!?]+/) ?? [""])[0].length;
      const segEnd = m.index + punctLen;
      const raw = p.slice(cursor, segEnd);

      const segWords = raw.trim().split(/\s+/).filter(Boolean);
      const lastWord = segWords.at(-1)?.replace(/[.!?]+$/, "") ?? "";
      const isAbbrev = lastWord.length <= 2 && /^[A-Z]/.test(lastWord);
      const isDecimal = /\d$/.test(raw.trimEnd().slice(0, -1) || "");

      if (!isAbbrev && !isDecimal) {
        const trimmed = raw.trim();
        const wc = trimmed.split(/\s+/).filter(Boolean).length;
        if (wc >= minWords && trimmed.length <= maxChars) {
          results.push(trimmed);
        }
        cursor = m.index + m[0].length;
      }
    }

    const remaining = p.slice(cursor).trim();
    if (remaining) {
      const wc = remaining.split(/\s+/).filter(Boolean).length;
      if (wc >= minWords && remaining.length <= maxChars) {
        results.push(remaining);
      }
    }
  }

  return results;
}

type AlignmentData = {
  tokens: TextToken[];
  alignment: Array<number | null>;
  spanLengths: number[];
};

function buildAlignment(plainText: string, words: Array<{ word: string }>): AlignmentData {
  const tokens = extractTextTokens(plainText);
  const { alignment, spanLengths } = buildTokenAlignment(tokens, words);
  return { tokens, alignment, spanLengths };
}

/** Finds the start/end audio times for a sentence using TTS word timings. */
export function findSpeechSentenceRange(
  sentence: string,
  plainText: string,
  words: WordTiming[],
  precomputed?: AlignmentData,
): { startTime: number; endTime: number } | null {
  if (words.length === 0 || !sentence) return null;

  const needle = sentence.slice(0, Math.min(30, sentence.length));
  const sentStart = plainText.indexOf(needle);
  if (sentStart === -1) return null;

  const sentEnd = sentStart + sentence.length;
  const { tokens, alignment, spanLengths } = precomputed ?? buildAlignment(plainText, words);
  const matching: WordTiming[] = [];

  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const tokenIndex = alignment[wordIndex];
    if (tokenIndex == null) continue;

    const spanLength = Math.max(1, spanLengths[wordIndex] ?? 1);
    const firstToken = tokens[tokenIndex];
    const lastToken = tokens[tokenIndex + spanLength - 1] ?? firstToken;
    if (!firstToken || !lastToken) continue;

    if (lastToken.end > sentStart && firstToken.start < sentEnd) {
      const word = words[wordIndex];
      if (word) matching.push(word);
    }
  }

  if (matching.length === 0) return null;

  return {
    startTime: timingStartSeconds(matching[0]),
    endTime: timingEndSeconds(matching[matching.length - 1]),
  };
}

/** Splits text and annotates each practisable sentence with audio timing. */
export function segmentSpeechPractice(
  plainText: string,
  words: WordTiming[],
  opts: PracticeSentenceOptions = {},
): SpeechPracticeSegment[] {
  const sentences = splitPracticeSentences(plainText, opts);
  if (!sentences.length || !words.length) return [];

  const alignment = buildAlignment(plainText, words);
  const segments: SpeechPracticeSegment[] = [];
  for (const sentence of sentences) {
    const range = findSpeechSentenceRange(sentence, plainText, words, alignment);
    if (range) {
      segments.push({ text: sentence, startTime: range.startTime, endTime: range.endTime });
    }
  }
  return segments;
}