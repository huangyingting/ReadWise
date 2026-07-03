/**
 * Pure helpers for the bilingual (parallel) reading view (#113).
 *
 * No server-only imports — safe to use in both client components and tests.
 */

/**
 * Splits sanitized article HTML into block-level paragraph chunks by inserting
 * a sentinel character after each block-level closing tag and splitting there.
 */
const PARAGRAPH_SENTINEL = "\x00";
const BLOCK_CLOSE_TAG_RE = /(<\/(?:p|h[1-6]|blockquote|li|div|figure|section)>)\s*/gi;

function splitAndTrimNonEmpty(text: string, separator: string | RegExp): string[] {
  return text
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitHtmlParagraphs(html: string): string[] {
  const sentineled = html.replace(BLOCK_CLOSE_TAG_RE, `$1${PARAGRAPH_SENTINEL}`);
  return splitAndTrimNonEmpty(sentineled, PARAGRAPH_SENTINEL);
}

/**
 * Splits translation plain text (paragraph-separated by blank lines) into
 * an array of paragraph strings.
 */
export function splitTranslationParagraphs(text: string): string[] {
  return splitAndTrimNonEmpty(text, /\n{2,}/);
}

/**
 * Best-effort 1:1 alignment of source HTML paragraphs and translated text paragraphs.
 *
 * When counts match exactly, each source paragraph is paired 1:1 with its translation.
 * When translation has fewer paragraphs, the remaining source paragraphs get
 * `trans: null` (rendered without translation). Extra translation paragraphs
 * beyond the source count are discarded.
 */
export function alignParagraphs(
  srcParagraphs: string[],
  transParagraphs: string[],
): Array<{ src: string; trans: string | null }> {
  return srcParagraphs.map((src, i) => ({
    src,
    trans: transParagraphs[i] ?? null,
  }));
}
