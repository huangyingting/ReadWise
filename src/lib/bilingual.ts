/**
 * Pure helpers for the bilingual (parallel) reading view (#113).
 *
 * No server-only imports — safe to use in both client components and tests.
 */

/**
 * Splits sanitized article HTML into block-level paragraph chunks by inserting
 * a sentinel character after each block-level closing tag and splitting there.
 */
export function splitHtmlParagraphs(html: string): string[] {
  const BLOCK_CLOSE_RE = /(<\/(?:p|h[1-6]|blockquote|li|div|figure|section)>)\s*/gi;
  const sentineled = html.replace(BLOCK_CLOSE_RE, "$1\x00");
  return sentineled
    .split("\x00")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Splits translation plain text (paragraph-separated by blank lines) into
 * an array of paragraph strings.
 */
export function splitTranslationParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
