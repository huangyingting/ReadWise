/**
 * ReadWise speech timing helpers.
 *
 * Runtime speech timings are audio-time words: { word, offset, duration }, with
 * offset/duration in milliseconds. Text highlighting maps those timings to the
 * current article content using word-token alignment.
 */

export type WordTiming = {
  word: string;
  offset: number;
  duration: number;
};

export type SpeechWord = WordTiming;

export type TextToken = {
  start: number;
  end: number;
  value: string;
  normalized: string;
};

export type ComparableToken = Pick<TextToken, "value" | "normalized">;

const LETTER_CONNECTOR_CLASS = "['''ʼʻ‛′\\u2019\\-\\u2010\\u2011]";
const NUMBER_RANGE_CONNECTOR_CLASS = "[\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212]";
const NUMBER_INNER_SEPARATOR_CLASS = "[:/\\u2236]";
const DIGIT_GROUP = "[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?";
const NUMBER_CORE = `(?:\\$)?${DIGIT_GROUP}(?:${NUMBER_INNER_SEPARATOR_CLASS}${DIGIT_GROUP})*%?`;
const NUMBER_PATTERN = `${NUMBER_CORE}(?:${NUMBER_RANGE_CONNECTOR_CLASS}${NUMBER_CORE})*`;
const ORDINAL_PATTERN = "[0-9]+(?:st|nd|rd|th)";

export const WORD_PATTERN =
  `([A-Za-z](?:\\.[A-Za-z])+\\.?|${ORDINAL_PATTERN}|${NUMBER_PATTERN}|[A-Za-z0-9]+(?:${LETTER_CONNECTOR_CLASS}[A-Za-z0-9]+)*)`;

export function createWordRegex(): RegExp {
  return new RegExp(WORD_PATTERN, "g");
}

export function createComparableKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const alphanumeric = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  return alphanumeric || trimmed.toLowerCase();
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

/**
 * Builds a forward-only alignment from TTS word timing entries to source text
 * tokens.
 */
export function buildTokenAlignment(
  tokens: ComparableToken[],
  wordTimings: Array<{ word: string }>,
): { alignment: Array<number | null>; spanLengths: number[] } {
  if (!tokens.length || !wordTimings.length) {
    return { alignment: [], spanLengths: [] };
  }

  const alignment: Array<number | null> = new Array(wordTimings.length).fill(null);
  const spanLengths: number[] = new Array(wordTimings.length).fill(1);
  let tokenCursor = -1;

  for (let wordIndex = 0; wordIndex < wordTimings.length; wordIndex++) {
    const timingWord = wordTimings[wordIndex]?.word ?? "";
    if (!timingWord.trim()) {
      continue;
    }

    const comparable = createComparableKey(timingWord);
    const fallback = timingWord.trim().toLowerCase();
    const wordPartsRaw = timingWord.split(/\s+/).filter(Boolean);
    const normalizedParts = wordPartsRaw
      .map((part) => createComparableKey(part))
      .filter(Boolean);
    const fallbackParts = wordPartsRaw
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    let matched = false;

    for (let tokenIndex = tokenCursor + 1; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      if (!token) continue;

      const tokenNormalized = token.normalized;
      const tokenFallback = token.value.trim().toLowerCase();
      const normalizedMatch = comparable && tokenNormalized === comparable;
      const fallbackMatch = !comparable && fallback && tokenFallback === fallback;

      if (normalizedMatch || fallbackMatch) {
        alignment[wordIndex] = tokenIndex;
        spanLengths[wordIndex] = 1;
        tokenCursor = tokenIndex;
        matched = true;
        break;
      }

      // Possessive tolerance in both directions:
      // TTS "Japan" <-> text "Japan's", and TTS "China's" <-> text "China".
      if (tokenNormalized.endsWith("s") && comparable && tokenNormalized === `${comparable}s`) {
        alignment[wordIndex] = tokenIndex;
        spanLengths[wordIndex] = 1;
        tokenCursor = tokenIndex;
        matched = true;
        break;
      }

      if (comparable.endsWith("s") && tokenNormalized && comparable === `${tokenNormalized}s`) {
        alignment[wordIndex] = tokenIndex;
        spanLengths[wordIndex] = 1;
        tokenCursor = tokenIndex;
        matched = true;
        break;
      }

      // Multi-word timing entry, e.g. "1st Place", should span multiple text tokens.
      if (normalizedParts.length > 1 || fallbackParts.length > 1) {
        const primaryNormalized = normalizedParts[0];
        const primaryFallback = fallbackParts[0];
        const primaryMatch =
          (primaryNormalized && tokenNormalized === primaryNormalized) ||
          (!primaryNormalized && primaryFallback && tokenFallback === primaryFallback);

        if (primaryMatch) {
          let span = 1;
          let nextTokenIndex = tokenIndex + 1;
          const totalParts = Math.max(normalizedParts.length, fallbackParts.length);
          let partsMatch = true;

          for (let partIndex = 1; partIndex < totalParts; partIndex++) {
            const expectedNormalized = normalizedParts[partIndex] ?? "";
            const expectedFallback = fallbackParts[partIndex] ?? "";
            const nextToken = tokens[nextTokenIndex];
            if (!nextToken) {
              partsMatch = false;
              break;
            }

            const nextTokenNormalized = nextToken.normalized;
            const nextTokenFallback = nextToken.value.trim().toLowerCase();
            const partMatch =
              (!!expectedNormalized && nextTokenNormalized === expectedNormalized) ||
              (!expectedNormalized && !!expectedFallback && nextTokenFallback === expectedFallback);

            if (!partMatch) {
              partsMatch = false;
              break;
            }

            span += 1;
            nextTokenIndex += 1;
          }

          if (partsMatch) {
            alignment[wordIndex] = tokenIndex;
            spanLengths[wordIndex] = span;
            tokenCursor = tokenIndex + span - 1;
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      // Leave alignment[wordIndex] as null; later words may still realign.
    }
  }

  return { alignment, spanLengths };
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
