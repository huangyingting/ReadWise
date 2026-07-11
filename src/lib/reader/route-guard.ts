/**
 * Reader route guard (REF-003).
 *
 * Centralizes readable-article lookup and uniform 404 enforcement for all
 * reader routes. AI variants also consume the user-keyed rate-limit quota —
 * but ONLY AFTER the article-readability check passes (IDOR + quota safety).
 *
 * Reader ownership note: route guards/schemas/commands live in this module;
 * page rendering/loading stays in `page-loader.ts` and is intentionally
 * separate.
 */
import type { Article } from "@prisma/client";
import { ApiError } from "@/lib/errors/api-error";
import {
  articleAccessContext,
  getReadableArticleById,
  type ArticleAccessContext,
} from "@/lib/article-library";
import { checkRateLimit } from "@/lib/security/rate-limit/index";

/** Minimal user shape compatible with Session["user"] from createHandler. */
export type ReaderUser = { id: string; role?: string | null };

const ARTICLE_NOT_FOUND_ERROR = "Article not found";
const AI_RATE_LIMIT_SCOPE = "ai";

export type ReadableArticleResult = {
  article: Article;
  context: ArticleAccessContext;
};

function articleNotFound(): ApiError {
  return new ApiError(404, ARTICLE_NOT_FOUND_ERROR);
}

/**
 * Resolves the readable article for the given id and authenticated user.
 * Throws a uniform ApiError(404) if the article is missing or not readable
 * by this user.
 *
 * Use for non-AI reader routes (highlights, progress, offline, etc.)
 */
export async function requireReadableArticle(
  id: string,
  user: ReaderUser,
): Promise<ReadableArticleResult> {
  const context = articleAccessContext(user);
  const article = await getReadableArticleById(id, context);
  if (!article) throw articleNotFound();
  return { article, context };
}

/**
 * Resolves the readable article for the given id, then consumes the
 * user-keyed AI rate-limit quota.
 *
 * ORDER IS A HARD SECURITY REQUIREMENT:
 *   1. Check article readability (IDOR guard — rejects private article IDs
 *      that the caller cannot read before any quota is spent).
 *   2. Consume AI rate-limit quota ONLY after access is confirmed.
 *   3. Route handler performs AI work.
 *
 * Never reorder steps 1 and 2: doing so would waste quota on denied private
 * article IDs and could reveal article existence via rate-limit exhaustion.
 *
 * Use for AI reader routes (translation, vocabulary, quiz, speech, etc.)
 */
export async function requireReadableArticleForAI(
  id: string,
  user: ReaderUser,
): Promise<ReadableArticleResult> {
  const result = await requireReadableArticle(id, user);
  await checkRateLimit(user.id, AI_RATE_LIMIT_SCOPE);
  return result;
}
