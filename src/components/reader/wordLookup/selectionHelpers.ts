/**
 * Pure DOM/selection helpers for the WordLookup reader interaction subsystem.
 * These functions are free of React state so they can be imported and tested
 * independently of the component tree.
 */

/** Anchor data captured when the user makes a selection inside the prose surface. */
export interface SavedAnchor {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  /** The first word of the selection, used for "Define" from the toolbar. */
  selectionWord: string;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

type CaretPosition = {
  node: Node;
  offset: number;
};

const WORD_CHAR_PATTERN = /[A-Za-z'-]/;
const MAX_CONTEXT_SENTENCE_LENGTH = 400;
const SENTENCE_SPLIT_PATTERN = /(?<=[.?!])\s+/;

function caretAtPoint(x: number, y: number): CaretPosition | null {
  const doc = document as CaretDocument;

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }

  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }

  return null;
}

function isWordChar(char: string): boolean {
  return WORD_CHAR_PATTERN.test(char);
}

function wordBoundsAtOffset(text: string, offset: number): [number, number] {
  let start = Math.min(offset, text.length);
  let end = start;

  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;

  return [start, end];
}

/**
 * Returns the word under the pointer (x, y), or null when the pointer is not
 * over a text node. Tries `caretRangeFromPoint` (Chrome/Safari) first and
 * falls back to `caretPositionFromPoint` (Firefox).
 */
export function wordAtPoint(x: number, y: number): string | null {
  if (typeof document === "undefined") return null;
  const caret = caretAtPoint(x, y);

  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;

  const text = caret.node.textContent ?? "";
  const [start, end] = wordBoundsAtOffset(text, caret.offset);
  return text.slice(start, end).trim() || null;
}

/**
 * Extracts the sentence containing `word` from the prose element's text
 * content. Splits on `.`, `?`, `!` followed by whitespace or end-of-string,
 * and on paragraph breaks. Returns the trimmed sentence or null when not
 * found. Sentences longer than 400 characters are skipped to avoid returning
 * run-on fragments.
 */
export function extractContextSentence(
  proseEl: HTMLElement,
  word: string,
): string | null {
  const text = proseEl.textContent ?? "";
  if (!text || !word) return null;
  const sentences = text.split(SENTENCE_SPLIT_PATTERN);
  const lower = word.toLowerCase();
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(lower)) {
      const trimmed = sentence.trim();
      if (
        trimmed.length > 0 &&
        trimmed.length <= MAX_CONTEXT_SENTENCE_LENGTH
      ) {
        return trimmed;
      }
    }
  }
  return null;
}
