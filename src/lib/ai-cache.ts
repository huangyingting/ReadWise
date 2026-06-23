/**
 * Shared cache-first AI lifecycle for per-article derived content.
 *
 * Every AI helper that enriches a single article (translation, vocabulary, quiz,
 * tags, ...) follows the same lifecycle:
 *
 *   1. Read a per-article cache row; on a hit, return it (no AI call).
 *   2. Load the article's text; if it doesn't exist, return null.
 *   3. If the AI provider is unconfigured, return a graceful fallback (NOT cached).
 *   4. Build chat messages, call the provider with a `feature` label, parse the
 *      (fence-tolerant) response.
 *   5. If the response is empty / unparseable, return a graceful fallback (NOT cached).
 *   6. Otherwise persist the parsed result and return it.
 *
 * {@link getOrCreateArticleAi} captures that flow once so individual helpers only
 * declare the parts that differ (cache shape, prompt, parser, persistence, and how
 * to build their public result). The "don't cache fallbacks" rule and the `feature`
 * plumbing live here so they can't drift between helpers.
 */

import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import {
  loadAiProcessableArticleText,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** The minimal article shape shared helpers need to build a prompt. */
export type ArticleText = {
  title: string;
  content: string;
};

/** The default article loader: title + content by id, or null when missing. */
export async function loadArticleText(
  articleId: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<ArticleText | null> {
  if (!context || !isArticleOperator(context)) {
    return loadAiProcessableArticleText(articleId, context);
  }
  return prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, content: true },
  });
}

/**
 * Conditional helper: makes `loadArticle` optional when `TArticle` is exactly
 * `ArticleText` (or structurally equivalent), and required otherwise.  Callers
 * that use a richer `TArticle` without providing a custom loader will get a
 * compile-time error instead of silently falling back to the wrong shape.
 */
type LoadArticleField<TArticle extends ArticleText> = ArticleText extends TArticle
  ? { loadArticle?: (articleId: string, context: ArticleAccessContext | null) => Promise<TArticle | null> }
  : { loadArticle: (articleId: string, context: ArticleAccessContext | null) => Promise<TArticle | null> };

/**
 * Declares the feature-specific pieces of the shared cache-first AI lifecycle.
 *
 * @typeParam TArticle - the loaded article shape (defaults to {@link ArticleText})
 * @typeParam TParsed  - the parsed model output (before persistence)
 * @typeParam TCache   - the cached/persisted value passed to `toResult`
 * @typeParam TResult  - the helper's public return value
 */
export type ArticleAiSpec<TArticle extends ArticleText, TParsed, TCache, TResult> =
  LoadArticleField<TArticle> & {
    /** Short label for structured AI logs (e.g. "translation", "quiz"). */
    feature: string;
    /** Reads the per-article cache; return null to signal a miss. */
    readCache: (articleId: string) => Promise<TCache | null>;
    /** Builds the chat messages sent to the provider on a cache miss. */
    buildMessages: (article: TArticle) => ChatMessage[];
    /** Fence-tolerant parse of the raw model response into TParsed. */
    parse: (completion: string) => TParsed;
    /** Whether the parsed value is empty (→ graceful fallback, not cached). */
    isEmpty: (parsed: TParsed) => boolean;
    /** Persists the parsed value and returns the cache shape for `toResult`. */
    persist: (
      articleId: string,
      parsed: TParsed,
      article: TArticle,
    ) => Promise<TCache>;
    /** Builds the public result from a cached or freshly-persisted value. */
    toResult: (
      cache: TCache,
      ctx: { cached: boolean },
    ) => TResult | Promise<TResult>;
    /** Builds the graceful fallback result (never cached). */
    fallback: (article: TArticle) => TResult | Promise<TResult>;
    /** Optional cap on output tokens for the provider call. */
    maxOutputTokens?: number;
  };

/**
 * Runs the shared cache-first AI lifecycle described by `spec`.
 *
 * Returns the helper's result, or null when the article does not exist. Fallbacks
 * (AI unconfigured, or an empty/failed generation) are returned but never cached,
 * so a real result can replace the placeholder on a later request.
 */
export async function getOrCreateArticleAi<
  TArticle extends ArticleText,
  TParsed,
  TCache,
  TResult,
>(
  articleId: string,
  spec: ArticleAiSpec<TArticle, TParsed, TCache, TResult>,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<TResult | null> {
  let article: TArticle | null | undefined;
  if (!isArticleOperator(context)) {
    const rawArticle = spec.loadArticle !== undefined
      ? await spec.loadArticle(articleId, context)
      : await loadArticleText(articleId, context);
    article = rawArticle as TArticle | null;
    if (article === null) {
      return null;
    }
  }

  const cached = await spec.readCache(articleId);
  if (cached !== null) {
    return spec.toResult(cached, { cached: true });
  }

  // Resolve the article.  `ArticleAiSpec.loadArticle` is conditionally required:
  // when TArticle extends ArticleText with extra fields the caller must supply a
  // loader; when TArticle IS ArticleText (structurally) the field is optional and
  // the default loadArticleText is safe.  The single `as` cast is valid because
  // the conditional type in the spec guarantees compatibility at the call site.
  const rawArticle = article ?? (spec.loadArticle !== undefined
    ? await spec.loadArticle(articleId, context)
    : await loadArticleText(articleId, context));
  article = rawArticle as TArticle | null;
  if (article === null) {
    return null;
  }

  if (!isAiConfigured()) {
    return spec.fallback(article);
  }

  const options: { feature: string; maxOutputTokens?: number } = {
    feature: spec.feature,
  };
  if (spec.maxOutputTokens != null) {
    options.maxOutputTokens = spec.maxOutputTokens;
  }

  const completion = await chatComplete(spec.buildMessages(article), options);
  const parsed = completion ? spec.parse(completion) : null;
  if (parsed === null || spec.isEmpty(parsed)) {
    // AI configured but request failed or yielded nothing — graceful fallback.
    return spec.fallback(article);
  }

  const stored = await spec.persist(articleId, parsed, article);
  return spec.toResult(stored, { cached: false });
}
