/**
 * Shared localStorage helper for the translation target language.
 * Used by the sentence-level translation popover so a reader's language choice
 * persists across selections.
 */

import { STORAGE_KEYS } from "./storage-keys";

export const TRANSLATE_LANG_KEY = STORAGE_KEYS.TRANSLATE_LANG;
export const TRANSLATE_LANG_DEFAULT = "zh-Hans";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined";
}

/** Read the persisted translation target language (or the default). */
export function getTranslateLang(): string {
  if (!canUseLocalStorage()) return TRANSLATE_LANG_DEFAULT;
  return localStorage.getItem(TRANSLATE_LANG_KEY) ?? TRANSLATE_LANG_DEFAULT;
}

/** Persist the translation target language. */
export function setTranslateLang(code: string): void {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(TRANSLATE_LANG_KEY, code);
}
