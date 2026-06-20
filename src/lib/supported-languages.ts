/**
 * Client-safe language constants for translation features.
 *
 * This module has NO server-only imports (no AI, no Prisma, no logger) so it
 * can be safely bundled for the browser by webpack. It is the single source of
 * truth for `SUPPORTED_LANGUAGES`; `src/lib/translation.ts` re-exports from
 * here to keep the server-side API unchanged.
 *
 * Background: `translation.ts` imports from `@/lib/ai` (which imports the
 * logger that uses `node:async_hooks`) at the module top-level. Any client
 * component that transitively imports a *value* from `translation.ts`
 * (e.g. `languageLabel`) therefore drags `node:async_hooks` into the browser
 * bundle, causing a webpack `UnhandledSchemeError`. Importing from this file
 * instead breaks that chain.
 */

export type SupportedLanguage = {
  code: string;
  label: string;
};

/** Target languages a reader can translate an article into. */
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "zh-Hans", label: "Chinese (Simplified)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ru", label: "Russian" },
];

export function isSupportedLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function languageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
