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
import { getProgress, getProgressMap } from "@/lib/engagement";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import {
  articleAccessContext,
  getReadableArticleById,
} from "@/lib/article-library/policy";
import {
  getOrCreateArticleTags,
  listRelatedArticles,
  type TagView,
} from "@/lib/article-library/collections/tags";
import { getArticleListMembership } from "@/lib/article-library/collections/membership";
import { listCategoryPage } from "@/lib/article-library/listings";
import { readingMinutesFor } from "@/lib/article-library/mapper";
import {
  sanitizeArticleHtml,
  articleHtmlToReaderTextFromSanitized,
} from "@/lib/content-pipeline";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { prisma } from "@/lib/prisma";
import { CEFR_LEVELS, type CefrLevel } from "@/lib/option-registries";

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

type DifficultyVote = ReaderPageData["userDifficultyVote"];
type ListMembership = Awaited<ReturnType<typeof getArticleListMembership>>;

/**
 * Reader keeps this orchestration because the "keep reading" fallback is page
 * UX policy: it blends related-article relevance with category fallback sizing
 * and ordering for this specific surface.
 */
async function resolveKeepReadingArticles(
  article: Article,
  relatedArticles: Article[],
): Promise<{ keepReadingArticles: Article[]; hadRelated: boolean }> {
  const keepReadingArticles = relatedArticles.slice(0, 3);
  if (keepReadingArticles.length > 0) {
    return { keepReadingArticles, hadRelated: true };
  }

  const fallbackPage = await listCategoryPage(article.category ?? null, { limit: 4 });
  return {
    keepReadingArticles: fallbackPage.articles
      .filter((a) => a.id !== article.id)
      .slice(0, 3),
    hadRelated: false,
  };
}

function isDefaultListBookmarked(membership: ListMembership): boolean {
  return membership?.find((l) => l.isDefault)?.hasArticle ?? false;
}

function difficultyVoteFromFeedback(feedback: { vote: string } | null): DifficultyVote {
  return (feedback?.vote as DifficultyVote) ?? null;
}

function readerBody(content: string): Pick<ReaderPageData, "cleanBody" | "articlePlainText"> {
  const cleanBody = sanitizeArticleHtml(content);
  return {
    cleanBody,
    articlePlainText: articleHtmlToReaderTextFromSanitized(cleanBody),
  };
}

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
  const { keepReadingArticles, hadRelated } = await resolveKeepReadingArticles(
    article,
    relatedArticles,
  );

  // relatedProgress depends on keepReadingArticles — must come after
  const relatedProgress = await getProgressMap(
    session.user.id,
    keepReadingArticles.map((a) => a.id),
  );

  const difficultyLevel = (difficulty?.level ?? article.difficulty) as CefrLevel | null;
  const tags = tagsResult?.tags ?? [];
  const isValidCefrLevel =
    difficultyLevel !== null && (CEFR_LEVELS as readonly string[]).includes(difficultyLevel);
  const { cleanBody, articlePlainText } = readerBody(article.content);

  return {
    article,
    progress,
    difficultyLevel,
    isValidCefrLevel,
    tags,
    keepReadingArticles,
    relatedProgress,
    isBookmarked: isDefaultListBookmarked(membership),
    isCompleted: progress?.completed ?? false,
    userDifficultyVote: difficultyVoteFromFeedback(existingFeedback),
    readingMinutes: readingMinutesFor(article),
    cleanBody,
    articlePlainText,
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
