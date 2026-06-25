/**
 * Reader page data loader (REF-029).
 *
 * Centralises all server-side data fetching for the reader page into a single
 * async function so `page.tsx` stays thin and the fetch logic is independently
 * testable.
 *
 * Authorization is enforced through `getReadableArticleById` (REF-003).
 * Analytics recording is best-effort and metadata-only — never article text.
 */
import type { Session } from "next-auth";
import type { Article, ReadingProgress } from "@prisma/client";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-library";
import { getProgress, getProgressMap } from "@/lib/progress";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleTags, listRelatedArticles } from "@/lib/article-library";
import type { TagView } from "@/lib/article-library";
import { listCategoryPage, readingMinutesFor } from "@/lib/article-library";
import { getArticleListMembership } from "@/lib/article-library";
import { sanitizeArticleHtml, articleHtmlToReaderText } from "@/lib/content-pipeline";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { prisma } from "@/lib/prisma";
import { CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";

export type ReaderPageData = {
  article: Article;
  progress: ReadingProgress | null;
  difficultyLevel: CefrLevel | null;
  /** Whether `difficultyLevel` is a recognised CEFR level string. */
  isValidCefrLevel: boolean;
  tags: TagView[];
  keepReadingArticles: Article[];
  relatedProgress: Map<string, ReadingProgress>;
  isBookmarked: boolean;
  isCompleted: boolean;
  userDifficultyVote: "too_easy" | "just_right" | "too_hard" | null;
  readingMinutes: number | null;
  /** Sanitized article HTML — safe to render via dangerouslySetInnerHTML. */
  cleanBody: string;
  articlePlainText: string;
  /**
   * True when `keepReadingArticles` came from tag-based related articles;
   * false when they fell back to same-category articles.
   */
  hadRelated: boolean;
};

/**
 * Loads all data required by the reader page for the given article id and
 * authenticated session. Returns `null` when the article does not exist or is
 * not readable by the session user — caller should invoke `notFound()`.
 *
 * Authorization is enforced through `getReadableArticleById` so no article
 * data is fetched or returned for ids the session user cannot read.
 *
 * The parallel Promise.all covers: progress, difficulty, tags, related
 * articles, list membership, and existing difficulty vote.  Related progress
 * is fetched after the keep-reading list is resolved (sequential dependency).
 */
export async function loadReaderPageData(
  articleId: string,
  session: Session,
): Promise<ReaderPageData | null> {
  const context = articleAccessContext(session.user);
  const article = await getReadableArticleById(articleId, context);
  if (!article) return null;

  // Product analytics (RW-051): record an article view. Best-effort + metadata
  // only (category/difficulty) — never the article text. Awaiting a single
  // insert that never throws keeps the page render reliable.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.articleView,
    userId: session.user.id,
    articleId: article.id,
    properties: { category: article.category, difficulty: article.difficulty },
  });

  // Parallel fetch: all six queries depend only on article.id / userId
  const [progress, difficulty, tagsResult, relatedArticles, membership, existingFeedback] =
    await Promise.all([
      getProgress(session.user.id, article.id),
      getOrCreateArticleDifficulty(article.id, context),
      getOrCreateArticleTags(article.id, context),
      listRelatedArticles(article.id),
      // M10: SSR bookmark state for the reader cluster
      getArticleListMembership(session.user.id, article.id, session.user.role),
      // #124: existing difficulty vote for this user+article (may be null)
      prisma.articleDifficultyFeedback.findUnique({
        where: { userId_articleId: { userId: session.user.id, articleId: article.id } },
        select: { vote: true },
      }),
    ]);

  // If no related articles, fall back to articles from the same category.
  const hadRelated = relatedArticles.length > 0;
  let keepReadingArticles = relatedArticles.slice(0, 3);
  if (keepReadingArticles.length === 0) {
    const fallbackPage = await listCategoryPage(article.category ?? null, { limit: 4 });
    keepReadingArticles = fallbackPage.articles
      .filter((a) => a.id !== article.id)
      .slice(0, 3);
  }

  // relatedProgress depends on keepReadingArticles — must come after
  const relatedProgress = await getProgressMap(
    session.user.id,
    keepReadingArticles.map((a) => a.id),
  );

  const difficultyLevel = (difficulty?.level ?? article.difficulty) as CefrLevel | null;
  const tags = tagsResult?.tags ?? [];
  const isValidCefrLevel =
    difficultyLevel !== null && (CEFR_LEVELS as readonly string[]).includes(difficultyLevel);

  return {
    article,
    progress,
    difficultyLevel,
    isValidCefrLevel,
    tags,
    keepReadingArticles,
    relatedProgress,
    isBookmarked: membership?.find((l) => l.isDefault)?.hasArticle ?? false,
    isCompleted: progress?.completed ?? false,
    userDifficultyVote:
      (existingFeedback?.vote as "too_easy" | "just_right" | "too_hard" | null) ?? null,
    readingMinutes: readingMinutesFor(article),
    cleanBody: sanitizeArticleHtml(article.content),
    articlePlainText: articleHtmlToReaderText(article.content),
    hadRelated,
  };
}

/**
 * Builds a schema.org NewsArticle JSON-LD object for the given article.
 * Caller is responsible for safe serialisation via `safeJsonStringify`.
 */
export function buildArticleJsonLd(
  article: Pick<Article, "title" | "author" | "source" | "publishedAt" | "heroImage">,
  descriptionText: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: descriptionText.trim().replace(/\s+/g, " ").slice(0, 200),
    ...(article.author ? { author: { "@type": "Person", name: article.author } } : {}),
    publisher: {
      "@type": "Organization",
      name: article.source ?? "ReadWise",
    },
    ...(article.publishedAt
      ? { datePublished: new Date(article.publishedAt).toISOString() }
      : {}),
    ...(article.heroImage ? { image: article.heroImage } : {}),
  };
}
