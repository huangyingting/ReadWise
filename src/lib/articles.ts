import { prisma } from "@/lib/prisma";
import type { Article } from "@prisma/client";

const WORDS_PER_MINUTE = 200;

export function getArticleById(id: string): Promise<Article | null> {
  return prisma.article.findUnique({ where: { id } });
}

export function countWords(text: string): number {
  const stripped = text.replace(/<[^>]*>/g, " ");
  const matches = stripped.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Estimated minutes to read. Prefers the stored value, otherwise derives it
 * from the stored word count or, as a last resort, the body text.
 */
export function readingMinutesFor(article: Article): number | null {
  if (article.readingMinutes != null) {
    return article.readingMinutes;
  }
  const words = article.wordCount ?? countWords(article.content);
  if (words <= 0) {
    return null;
  }
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
