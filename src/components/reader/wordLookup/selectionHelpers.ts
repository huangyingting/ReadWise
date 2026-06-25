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

/**
 * Returns the word under the pointer (x, y), or null when the pointer is not
 * over a text node. Tries `caretRangeFromPoint` (Chrome/Safari) first and
 * falls back to `caretPositionFromPoint` (Firefox).
 */
export function wordAtPoint(x: number, y: number): string | null {
  if (typeof document === "undefined") return null;
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent ?? "";
  const isWordChar = (c: string) => /[A-Za-z'''-]/.test(c);
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
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
  const sentences = text.split(/(?<=[.?!])\s+/);
  const lower = word.toLowerCase();
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(lower)) {
      const trimmed = sentence.trim();
      if (trimmed.length > 0 && trimmed.length <= 400) return trimmed;
    }
  }
  return null;
}
