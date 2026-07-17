import { extractSpeechBoundaryTokens, type SpeechWord } from "./timing";
import { buildTokenAlignment } from "./timing-alignment";

function hasTextSpan(word: SpeechWord): boolean {
  return (
    typeof word.textStart === "number" &&
    Number.isFinite(word.textStart) &&
    typeof word.textEnd === "number" &&
    Number.isFinite(word.textEnd) &&
    word.textStart >= 0 &&
    word.textEnd > word.textStart
  );
}

function neighbourFallbackSpan(
  spans: Array<[number, number] | null>,
  index: number,
  plainTextLength: number,
): [number, number] {
  let previousEnd = 0;
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    const span = spans[candidate];
    if (span !== null) {
      previousEnd = span[1];
      break;
    }
  }

  let nextStart = plainTextLength;
  for (let candidate = index + 1; candidate < spans.length; candidate++) {
    const span = spans[candidate];
    if (span !== null) {
      nextStart = span[0];
      break;
    }
  }

  const start = Math.min(previousEnd, plainTextLength - 1);
  const end = Math.max(start + 1, Math.min(nextStart, plainTextLength));
  return [start, end];
}

export function enrichSpeechTimingSpans(
  words: SpeechWord[],
  plainText: string,
): SpeechWord[] {
  if (words.length === 0 || !plainText) return words;
  if (words.every(hasTextSpan)) return words;

  const tokens = extractSpeechBoundaryTokens(plainText);
  const { alignment, spanLengths } = buildTokenAlignment(tokens, words);
  const spans: Array<[number, number] | null> = words.map((word, index) => {
    if (hasTextSpan(word)) return [word.textStart!, word.textEnd!];

    const tokenIndex = alignment[index];
    if (tokenIndex == null) return null;

    const spanLength = Math.max(1, spanLengths[index] ?? 1);
    const firstToken = tokens[tokenIndex];
    const lastToken = tokens[tokenIndex + spanLength - 1] ?? firstToken;
    if (!firstToken || !lastToken) return null;
    return [firstToken.start, lastToken.end];
  });

  const enriched: SpeechWord[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    const span = spans[index];
    if (span !== null) {
      enriched.push({ ...word, textStart: span[0], textEnd: span[1] });
      continue;
    }

    if (word.endMs === word.startMs) continue;

    const fallback = neighbourFallbackSpan(spans, index, plainText.length);
    enriched.push({ ...word, textStart: fallback[0], textEnd: fallback[1] });
  }

  return enriched;
}