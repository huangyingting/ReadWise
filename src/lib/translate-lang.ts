/**
 * Shared localStorage helper for the translation target language.
 * Used by the sentence-level translation popover so a reader's language choice
 * persists across selections.
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
