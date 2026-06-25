/**
 * Reader route guard (REF-003).
 *
 * Centralizes readable-article lookup and uniform 404 enforcement for all
 * reader routes. AI variants also consume the user-keyed rate-limit quota —
 * but ONLY AFTER the article-readability check passes (IDOR + quota safety).
 */
import type { Article } from "@prisma/client";
import { ApiError } from "@/lib/api-handler";
import {
  articleAccessContext,
  getReadableArticleById,
  type ArticleAccessContext,
} from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

/** Minimal user shape compatible with Session["user"] from createHandler. */
export type ReaderUser = { id: string; role?: string | null };

export type ReadableArticleResult = {
  article: Article;
  context: ArticleAccessContext;
};

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
  if (!article) throw new ApiError(404, "Article not found");
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
  await checkRateLimit(user.id, "ai");
  return result;
}
