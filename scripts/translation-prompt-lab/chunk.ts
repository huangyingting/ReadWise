/**
 * Token-bounded, paragraph-aware chunking for long article translation.
 *
 * `Qwen/Qwen3.6-27B` on this vLLM deployment advertises a 262144-token
 * context window, so INPUT length alone rarely forces chunking. What does
 * force it:
 *   1. `max_tokens` (the OUTPUT budget) — a single request still needs an
 *      output cap, and the cap has to scale with the input or long articles
 *      get truncated mid-translation (`finish_reason: "length"`).
 *   2. Empirically, single-shot generation over very long inputs is less
 *      reliable than several bounded chunks: see
 *      `docs/ai/provider-db-translation-prompts.md` for the stress test
 *      (a ~700-paragraph, 90k-char article) that motivated this module —
 *      one-shot generation truncated well before the end of the article
 *      even with a generous `max_tokens`, while chunking completed cleanly.
 *
 * This mirrors the production `chunkForFeature`/`chunkText` strategy in
 * `src/lib/ai/chunking.ts` (paragraph-first, sentence-fallback, token
 * budgets expressed via the same chars≈4·tokens heuristic) but is
 * standalone so the lab has no dependency on the production AI stack.
 */

/** Average characters per token for the heuristic estimator (no tokenizer). */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type TextChunk = {
  text: string;
  index: number;
  total: number;
  charCount: number;
};

const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+/;

/** Splits a single over-budget paragraph on sentence boundaries. */
function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(SENTENCE_BOUNDARY_RE);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  // A single sentence longer than maxChars (rare: e.g. a giant list/quote) —
  // hard-split it rather than emitting an unbounded chunk.
  return parts.flatMap((part) =>
    part.length <= maxChars
      ? [part]
      : Array.from({ length: Math.ceil(part.length / maxChars) }, (_, i) =>
          part.slice(i * maxChars, (i + 1) * maxChars),
        ),
  );
}

/**
 * Splits `text` into token-bounded chunks, never splitting a paragraph
 * unless the paragraph alone exceeds the budget (then falls back to
 * sentence, then hard, splitting). Chunk boundaries always fall on
 * paragraph/sentence breaks so each chunk can be translated independently
 * and rejoined with `\n\n` without losing or duplicating content.
 */
export function chunkArticleText(text: string, maxInputTokens: number): TextChunk[] {
  const maxChars = Math.max(200, maxInputTokens * CHARS_PER_TOKEN);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      pieces.push(current);
      current = "";
    }
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      pieces.push(...splitOversizedParagraph(paragraph, maxChars));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();

  return pieces.map((chunkText, index) => ({
    text: chunkText,
    index,
    total: pieces.length,
    charCount: chunkText.length,
  }));
}
