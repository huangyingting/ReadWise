import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured, aiModelName } from "@/lib/ai";

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

export type TranslationResult = {
  lang: string;
  languageLabel: string;
  content: string;
  cached: boolean;
  fallback: boolean;
};

/** Max characters of source text sent to the model (keeps token use bounded). */
const MAX_SOURCE_CHARS = 8000;

/**
 * Converts stored article HTML into plain text with blank-line paragraph
 * separators, suitable as model input and for paragraph-wise rendering.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function fallbackText(label: string): string {
  return (
    `Translation into ${label} is unavailable right now because the AI ` +
    `translation service is not configured. Please try again later.`
  );
}

/**
 * Returns the cached translation for an article+language, generating and
 * caching it via the AI provider on a cache miss. When the AI provider is not
 * configured, returns a graceful placeholder and does NOT cache it.
 */
export async function getOrCreateTranslation(
  articleId: string,
  lang: string,
): Promise<TranslationResult | null> {
  const label = languageLabel(lang);

  const cached = await prisma.translation.findUnique({
    where: { articleId_targetLang: { articleId, targetLang: lang } },
  });
  if (cached) {
    return {
      lang,
      languageLabel: label,
      content: cached.content,
      cached: true,
      fallback: false,
    };
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, content: true },
  });
  if (!article) {
    return null;
  }

  if (!isAiConfigured()) {
    return {
      lang,
      languageLabel: label,
      content: fallbackText(label),
      cached: false,
      fallback: true,
    };
  }

  const source = htmlToPlainText(article.content).slice(0, MAX_SOURCE_CHARS);
  const completion = await chatComplete([
    {
      role: "system",
      content:
        `You are a professional translator. Translate the user's article into ${label}. ` +
        "Preserve paragraph breaks. Output only the translated text with no commentary, " +
        "no notes, and no markdown fences.",
    },
    {
      role: "user",
      content: `Title: ${article.title}\n\n${source}`,
    },
  ]);

  if (!completion) {
    // AI configured but request failed — graceful fallback, not cached.
    return {
      lang,
      languageLabel: label,
      content: fallbackText(label),
      cached: false,
      fallback: true,
    };
  }

  const saved = await prisma.translation.upsert({
    where: { articleId_targetLang: { articleId, targetLang: lang } },
    update: { content: completion, model: aiModelName() },
    create: {
      articleId,
      targetLang: lang,
      content: completion,
      model: aiModelName(),
    },
  });

  return {
    lang,
    languageLabel: label,
    content: saved.content,
    cached: false,
    fallback: false,
  };
}
