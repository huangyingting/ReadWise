/**
 * Personalized "For You" feed — M15.
 *
 * Heuristic-only ranking (no AI). Scores published articles for a given user
 * using four signals: topic match, CEFR level proximity, freshness, and reading
 * history. Pure helper functions (scoreArticle, levelProximityScore, etc.) are
 * exported so tests can exercise them without a DB.
 *
 * Reading-history exclusion rules:
 *   - COMPLETED articles are hard-excluded from the feed (user has already
 *     finished them; they belong in reading history, not discovery).
 *   - IN-PROGRESS articles receive a soft score penalty (-15) so they rank
 *     lower, but are not dropped entirely — the continue-reading rail on the
 *     dashboard already surfaces them, and the feed is primarily for
 *     *discovery*, so they are deliberately de-prioritised rather than hidden
 *     entirely (some users may want to see them mixed in).
 *
 * No-profile fallback: if the user has no completed onboarding profile, the
 * feed degrades gracefully to a plain newest-first listing (same behaviour as
 * the uncategorised browse view) rather than erroring.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { DifficultyLevel } from "@/lib/difficulty";
import { isDifficultyLevel, levelRank, levelsAtOrBelow } from "@/lib/leveling/cefr-primitives";
import { getProfile } from "@/lib/profile";
import { parseTopics } from "@/lib/profile";
import { toListingArticle, type ListingArticle } from "@/lib/article-library";
import { createLogger } from "@/lib/observability/logger";
import { publicListableArticleWhere } from "@/lib/article-library";
import {
  buildTagMap,
  levelProximityScore,
  freshnessScore,
} from "@/lib/discovery-ranking";
import { createTenantCachedListing } from "@/lib/cache";
import { LISTING_KEYS } from "@/lib/listing-cache";

const log = createLogger("feed");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FEED_PAGE_SIZE = 10;
export const FEED_MAX_LIMIT = 24;

/** Safety cap: maximum articles fetched from DB for in-memory ranking. */
const MAX_FETCH = 200;

/** Maximum consecutive articles from the same category before diversity kicks in. */
const MAX_CONSECUTIVE_SAME_CATEGORY = 3;

/**
 * Columns needed to score, diversify and render a feed card. Deliberately
 * EXCLUDES the large `content` HTML — the feed never renders the body, and
 * dropping it cuts the fetched payload by orders of magnitude.
 */
const FEED_ARTICLE_SELECT = {
  id: true,
  title: true,
  author: true,
  source: true,
  heroImage: true,
  category: true,
  difficulty: true,
  difficultyScore: true,
  readingMinutes: true,
  wordCount: true,
  publishedAt: true,
  excerpt: true,
  status: true,
  ownerId: true,
} satisfies Prisma.ArticleSelect;

/** Article projection used throughout the feed (content-free). */
export type FeedArticle = Prisma.ArticleGetPayload<{ select: typeof FEED_ARTICLE_SELECT }>;

// ---------------------------------------------------------------------------
// Scoring weights (exported so tests can assert on them)
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS = {
  /** Article's category matches a user topic. */
  CATEGORY_MATCH: 40,
  /** Per-tag match with a user topic slug (each tag earns this; capped at TAG_MAX). */
  TAG_MATCH: 10,
  /** Maximum total score from tag matches. */
  TAG_MAX: 20,
  /** Perfect CEFR level match. */
  LEVEL_PERFECT: 30,
  /** Recency bonus for articles published within 7 days. */
  FRESHNESS_RECENT: 10,
  /** Soft penalty for in-progress articles (already surfaced in continue-reading rail). */
  IN_PROGRESS_PENALTY: 15,
} as const;

// ---------------------------------------------------------------------------
// Pure scoring helpers
// ---------------------------------------------------------------------------

// levelProximityScore and freshnessScore are defined in @/lib/discovery-ranking.

// ---------------------------------------------------------------------------
// Tag map helper
// ---------------------------------------------------------------------------

// buildTagMap and ArticleTagRow are defined in @/lib/discovery-ranking.

// ---------------------------------------------------------------------------
// Article scorer
// ---------------------------------------------------------------------------

export type ScoredArticle = {
  article: FeedArticle;
  score: number;
  reason: string;
};

export type ScoringContext = {
  userLevel: DifficultyLevel | null;
  userLevelRank: number | null;
  topicSet: Set<string>;
  tagSlugsForArticle: string[];
  completedIds: Set<string>;
  inProgressIds: Set<string>;
  now: Date;
};

/**
 * Scores a single article for a user. Returns `null` when the article should
 * be hard-excluded (i.e. the user has completed it). All other articles receive
 * a non-negative score (in-progress articles are soft-penalised).
 *
 * This is a pure function — callers supply all contextual data.
 */
export function scoreArticle(
  article: FeedArticle,
  ctx: ScoringContext,
): ScoredArticle | null {
  const { userLevel, userLevelRank, topicSet, tagSlugsForArticle, completedIds, inProgressIds, now } = ctx;

  // Hard exclude: completed articles are not "For You" discovery content.
  if (completedIds.has(article.id)) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  // ------------------------------------------------------------------
  // Signal 1: Topic match (strongest signal)
  // ------------------------------------------------------------------
  const categoryMatch = Boolean(article.category && topicSet.has(article.category));
  if (categoryMatch) {
    score += SCORE_WEIGHTS.CATEGORY_MATCH;
    const label =
      article.category!.charAt(0).toUpperCase() + article.category!.slice(1);
    reasons.push(`Matches your interest in ${label}`);
  }

  const matchingTags = tagSlugsForArticle.filter((slug) => topicSet.has(slug));
  const tagBoost = Math.min(matchingTags.length * SCORE_WEIGHTS.TAG_MATCH, SCORE_WEIGHTS.TAG_MAX);
  if (tagBoost > 0) {
    score += tagBoost;
    if (!categoryMatch) {
      reasons.push("Matches your interests");
    }
  }

  // ------------------------------------------------------------------
  // Signal 2: Level proximity
  // ------------------------------------------------------------------
  if (
    userLevelRank !== null &&
    article.difficulty &&
    isDifficultyLevel(article.difficulty)
  ) {
    const artRank = levelRank(article.difficulty);
    const lScore = levelProximityScore(artRank, userLevelRank);
    score += lScore;
    if (reasons.length === 0 && lScore >= SCORE_WEIGHTS.LEVEL_PERFECT) {
      reasons.push(`Right for your ${userLevel} level`);
    }
  } else {
    // No level context: modest base so the article isn't dropped unfairly.
    score += 5;
  }

  // ------------------------------------------------------------------
  // Signal 3: Freshness (mild recency bonus)
  // ------------------------------------------------------------------
  const fScore = freshnessScore(article.publishedAt, now);
  score += fScore;
  if (reasons.length === 0 && fScore >= 7) {
    reasons.push("New article");
  }

  // ------------------------------------------------------------------
  // Signal 4: In-progress soft penalty
  // (Completed articles are already excluded above)
  // ------------------------------------------------------------------
  if (inProgressIds.has(article.id)) {
    score -= SCORE_WEIGHTS.IN_PROGRESS_PENALTY;
  }

  const reason =
    reasons[0] ??
    (userLevel ? `Right for your ${userLevel} level` : "Recommended for you");

  return { article, score, reason };
}

// ---------------------------------------------------------------------------
// Diversity pass
// ---------------------------------------------------------------------------

/**
 * Light diversity reorder: prevents more than {@link MAX_CONSECUTIVE_SAME_CATEGORY}
 * consecutive articles from the same category. Deferred items are appended
 * at the end, preserving relative order among them. O(n).
 */
export function diversify(scored: ScoredArticle[]): ScoredArticle[] {
  const result: ScoredArticle[] = [];
  const deferred: ScoredArticle[] = [];
  let lastCategory: string | null = null;
  let run = 0;

  for (const item of scored) {
    const cat = item.article.category ?? null;
    if (cat !== null && cat === lastCategory && run >= MAX_CONSECUTIVE_SAME_CATEGORY) {
      deferred.push(item);
    } else {
      result.push(item);
      if (cat === lastCategory) {
        run++;
      } else {
        lastCategory = cat;
        run = 1;
      }
    }
  }

  result.push(...deferred);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FeedPage = {
  articles: ListingArticle[];
  hasMore: boolean;
  reasons: Record<string, string>;
};

/**
 * Returns a paginated, heuristic-ranked "For You" feed for the given user.
 *
 * Scoring signals (in descending weight):
 *   1. **Topic match** — category (+40) + matching tags (+10 each, cap +20)
 *   2. **Level proximity** — CEFR closeness to user's englishLevel (+0–30);
 *      too-hard penalised more steeply than slightly-easy
 *   3. **Freshness** — recency bonus (+0–10)
 *   4. **History** — completed articles EXCLUDED; in-progress articles get -15
 *      (they appear in the continue-reading rail, so this feed emphasises discovery)
 *   5. **Diversity** — no more than 3 consecutive same-category articles
 *
 * **No-profile fallback**: if the user has no completed onboarding profile,
 * degrades to a plain newest-first listing across all published articles —
 * never errors.
 *
 * Results are cached in Next's Data Cache keyed by (userId × offset × limit ×
 * maxLevel) and tagged with the user's cache tag so that profile, onboarding,
 * and article-completion mutations can invalidate precisely via
 * `revalidateUserCache(userId)`.
 *
 * No migration required — ranking is computed over existing columns
 * (category, difficulty, publishedAt) + joined ReadingProgress/ArticleTag data.
 */

/**
 * Inner (non-cached) fetch — resolves defaults and calls the ranking engine.
 * Wrapped by `cachedGetPersonalizedFeed` so Next's Data Cache handles memoisation.
 */
async function fetchPersonalizedFeed(
  userId: string,
  offset: number,
  limit: number,
  maxLevel: DifficultyLevel | null,
): Promise<FeedPage> {
  const now = new Date();
  return computePersonalizedFeed(userId, offset, limit, maxLevel, now);
}

const cachedGetPersonalizedFeed = createTenantCachedListing(
  fetchPersonalizedFeed,
  LISTING_KEYS.personalizedFeed,
  "user",
  { revalidate: 300 },
);

export async function getPersonalizedFeed(
  userId: string,
  opts: { offset?: number; limit?: number; maxLevel?: DifficultyLevel | null } = {},
): Promise<FeedPage> {
  const limit = opts.limit ?? FEED_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const maxLevel = opts.maxLevel ?? null;
  return cachedGetPersonalizedFeed(userId, offset, limit, maxLevel);
}

async function computePersonalizedFeed(
  userId: string,
  offset: number,
  limit: number,
  maxLevel: DifficultyLevel | null,
  now: Date,
): Promise<FeedPage> {
  // 1) Load user profile (non-fatal on missing)
  const profile = await getProfile(userId);
  const hasProfile = Boolean(profile?.completedAt);

  // 2) Pre-collect the user's COMPLETED article ids so we can exclude them at
  // the DB layer — completed articles are never "For You" discovery content,
  // and dropping them before fetch keeps the candidate set lean.
  const completedRows = await prisma.readingProgress.findMany({
    where: { userId, completed: true },
    select: { articleId: true },
  });
  const completedIds = new Set(completedRows.map((r) => r.articleId));

  // 3) Fetch candidate published articles (newest-first; content-free
  // projection; capped for memory safety). Completed articles are excluded at
  // the DB layer, and when a level cap is active we constrain difficulty too so
  // level-filtered feeds paginate correctly without over-fetching.
  const where: Prisma.ArticleWhereInput = publicListableArticleWhere({
    ...(completedIds.size > 0 ? { id: { notIn: [...completedIds] } } : {}),
    ...(maxLevel ? { difficulty: { in: levelsAtOrBelow(maxLevel) } } : {}),
  });
  const allArticles = await prisma.article.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_FETCH,
    select: FEED_ARTICLE_SELECT,
  });

  if (allArticles.length === 0) {
    return { articles: [], hasMore: false, reasons: {} };
  }

  // Warn when the corpus is approaching the cap (>= 80% of MAX_FETCH).
  if (allArticles.length >= MAX_FETCH * 0.8) {
    log.warn("feed.cap_approaching", {
      count: allArticles.length,
      cap: MAX_FETCH,
      note: "Feed candidate set is near the cap. Consider pre-computing rankings.",
    });
  }

  // ---- No-profile fallback: newest-first, no personalisation ----
  if (!hasProfile) {
    const page = allArticles.slice(offset, offset + limit);
    return {
      articles: page.map(toListingArticle),
      hasMore: offset + limit < allArticles.length,
      reasons: Object.fromEntries(page.map((a) => [a.id, "Recommended for you"])),
    };
  }

  const articleIds = allArticles.map((a) => a.id);

  // 4) Batch-load in-progress reading state for the candidates (one query —
  // no N+1). Completed rows were already handled via the DB exclusion above.
  const progressRows = await prisma.readingProgress.findMany({
    where: { userId, articleId: { in: articleIds }, completed: false },
    select: { articleId: true, percent: true },
  });

  const inProgressIds = new Set<string>();
  for (const row of progressRows) {
    if (row.percent > 0) {
      inProgressIds.add(row.articleId);
    }
  }

  // 5) Batch-load article tags (one query — no N+1)
  const tagRows = await prisma.articleTag.findMany({
    where: { articleId: { in: articleIds } },
    select: { articleId: true, tag: { select: { slug: true } } },
  });
  const tagMap = buildTagMap(tagRows);

  // 6) Build scoring context
  const userLevel = isDifficultyLevel(profile!.englishLevel)
    ? profile!.englishLevel
    : null;
  const userLvlRank = userLevel ? levelRank(userLevel) : null;
  const topicSet = new Set(parseTopics(profile!.topics));

  // 7) Score every article (null = hard-excluded)
  const ctx: ScoringContext = {
    userLevel,
    userLevelRank: userLvlRank,
    topicSet,
    tagSlugsForArticle: [], // placeholder; set per-article below
    completedIds,
    inProgressIds,
    now,
  };

  const scored: ScoredArticle[] = [];
  for (const article of allArticles) {
    const result = scoreArticle(article, {
      ...ctx,
      tagSlugsForArticle: tagMap.get(article.id) ?? [],
    });
    if (result !== null) {
      scored.push(result);
    }
  }

  // 8) Sort descending by score (DB recency order preserved within equal scores)
  scored.sort((a, b) => b.score - a.score);

  // 9) Light diversity pass (no more than 3 consecutive same-category)
  const diversified = diversify(scored);

  // 10) Paginate
  const page = diversified.slice(offset, offset + limit);
  const reasons: Record<string, string> = {};
  for (const item of page) {
    reasons[item.article.id] = item.reason;
  }

  return {
    articles: page.map((s) => toListingArticle(s.article)),
    hasMore: offset + limit < diversified.length,
    reasons,
  };
}
