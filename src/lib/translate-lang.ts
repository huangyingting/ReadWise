/**
 * Shared localStorage helper for the translation target language.
 * Used by both the M5 whole-article Translate tab (ArticleTranslation)
 * and the M13 sentence-level translation popover (SentenceTranslatePopover),
 * so a reader's language choice is shared across both surfaces.
 */

export const TRANSLATE_LANG_KEY = "readwise:translate-lang";
export const TRANSLATE_LANG_DEFAULT = "zh-Hans";

/** Read the persisted translation target language (or the default). */
export function getTranslateLang(): string {
  if (typeof window === "undefined") return TRANSLATE_LANG_DEFAULT;
  return localStorage.getItem(TRANSLATE_LANG_KEY) ?? TRANSLATE_LANG_DEFAULT;
}

/** Persist the translation target language. */
export function setTranslateLang(code: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRANSLATE_LANG_KEY, code);
}
