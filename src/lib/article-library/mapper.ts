/**
 * Article presentation mapper — card shaping and reading-time estimation
 * (article-library subsystem, REF-040).
 *
 * Pure functions with no database dependency; safe to import from any context
 * including client components that receive a partial article projection.
 */
import type { Article } from "@prisma/client";

const WORDS_PER_MINUTE = 200;

export function countWords(text: string): number {
  const stripped = text.replace(/<[^>]*>/g, " ");
  const matches = stripped.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Minimal article shape needed to render a listing card. Accepts full Article
 * rows as well as partial `select`-narrowed rows (e.g. the feed's projection
 * that omits the large `content` HTML), so `content` is optional here.
 */
export type ArticleCardSource = Pick<
  Article,
  | "id"
  | "title"
  | "author"
  | "source"
  | "category"
  | "difficulty"
  | "readingMinutes"
  | "wordCount"
  | "publishedAt"
  | "heroImage"
> & { content?: string | null };

/**
 * Estimated minutes to read. Prefers the stored value, otherwise derives it
 * from the stored word count or, as a last resort, the body text.
 */
export function readingMinutesFor(
  article: Pick<Article, "readingMinutes" | "wordCount"> & { content?: string | null },
): number | null {
  if (article.readingMinutes != null) {
    return article.readingMinutes;
  }
  const words = article.wordCount ?? countWords(article.content ?? "");
  if (words <= 0) {
    return null;
  }
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Plain, serializable shape for an article card (safe to send to the client). */
export type ListingArticle = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  category: string | null;
  difficulty: string | null;
  readingMinutes: number | null;
  publishedAt: string | null;
  heroImage: string | null;
};

export function toListingArticle(article: ArticleCardSource): ListingArticle {
  return {
    id: article.id,
    title: article.title,
    author: article.author,
    source: article.source,
    category: article.category,
    difficulty: article.difficulty,
    readingMinutes: readingMinutesFor(article),
    publishedAt: article.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : article.publishedAt
      ? new Date(article.publishedAt).toISOString()
      : null,
    heroImage: article.heroImage ?? null,
  };
}
