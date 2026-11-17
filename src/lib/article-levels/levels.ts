/**
 * Article reading levels (#1303). Client-safe.
 *
 * An article's canonical text (`Article.content`) is the "original" level.
 * Optional `ArticleLevel` variants adapt it to CEFR targets; each has a nominal
 * Lexile-style band for display (the stored `lexileApprox` is measured from the
 * variant text when it is saved).
 */

export const ORIGINAL_LEVEL = "original" as const;

/** Adaptable levels, easiest first. */
export const ARTICLE_LEVEL_KEYS = ["A2", "B1", "B2", "C1"] as const;

export type ArticleLevelKey = (typeof ARTICLE_LEVEL_KEYS)[number];
export type ReadingLevelKey = ArticleLevelKey | typeof ORIGINAL_LEVEL;

/** Every level a reader can show, easiest first, then the original. */
export const READING_LEVEL_KEYS = [...ARTICLE_LEVEL_KEYS, ORIGINAL_LEVEL] as const;

/** Nominal Lexile-style band shown next to each adapted level. */
export const LEVEL_NOMINAL_LEXILE: Record<ArticleLevelKey, number> = {
  A2: 600,
  B1: 850,
  B2: 1050,
  C1: 1200,
};

export function isArticleLevelKey(value: unknown): value is ArticleLevelKey {
  return typeof value === "string" && (ARTICLE_LEVEL_KEYS as readonly string[]).includes(value);
}

export function isReadingLevelKey(value: unknown): value is ReadingLevelKey {
  return value === ORIGINAL_LEVEL || isArticleLevelKey(value);
}

/** Parses a `?level=` value; anything unknown means the original text. */
export function parseReadingLevel(value: unknown): ReadingLevelKey {
  return isReadingLevelKey(value) ? value : ORIGINAL_LEVEL;
}

/** "Original" or e.g. "B1 · ~850L". */
export function readingLevelLabel(level: ReadingLevelKey, lexileApprox?: number | null): string {
  if (level === ORIGINAL_LEVEL) return "Original";
  return `${level} · ~${lexileApprox ?? LEVEL_NOMINAL_LEXILE[level]}L`;
}

/** Reader URL for an article at a level (the original level has no query). */
export function readerLevelHref(articleId: string, level: ReadingLevelKey): string {
  const base = `/reader/${encodeURIComponent(articleId)}`;
  return level === ORIGINAL_LEVEL ? base : `${base}?level=${level}`;
}

/** Query suffix for level-scoped reader APIs ("" for the original level). */
export function levelQuery(level: ReadingLevelKey, separator: "?" | "&" = "?"): string {
  return level === ORIGINAL_LEVEL ? "" : `${separator}level=${level}`;
}

/** Sort key: adapted levels easiest first, then the original. */
export function readingLevelRank(level: ReadingLevelKey): number {
  return level === ORIGINAL_LEVEL ? ARTICLE_LEVEL_KEYS.length : ARTICLE_LEVEL_KEYS.indexOf(level);
}
