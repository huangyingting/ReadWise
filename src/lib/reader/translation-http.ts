/** HTTP guards shared by the reader's article and sentence translation routes. */
import { ApiError } from "@/lib/errors/api-error";
import { isSupportedLanguage } from "@/lib/supported-languages";

/** 400 unless `lang` is a supported translation target. */
export function requireSupportedTargetLanguage(lang: string): void {
  if (!isSupportedLanguage(lang)) {
    throw new ApiError(400, "Unsupported target language");
  }
}

/** Uniform 404 when the translation service found no readable article content. */
export function requireTranslationResult<T>(result: T | null): T {
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return result;
}
