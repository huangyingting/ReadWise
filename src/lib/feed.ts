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
import type { Article } from "@prisma/client";
import { isDifficultyLevel, levelRank, heuristicDifficulty } from "@/lib/difficulty";
import type { DifficultyLevel } from "@/lib/difficulty";
import { getProfile, parseTopics } from "@/lib/profile";
import { toListingArticle, type ListingArticle } from "@/lib/articles";
import { createLogger } from "@/lib/logger";

const log = createLogger("feed");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FEED_PAGE_SIZE = 10;
export const FEED_MAX_LIMIT = 24;

/** Safety cap: maximum articles fetched from DB for in-memory ranking. */
const MAX_FETCH = 1000;

/** Maximum consecutive articles from the same category before diversity kicks in. */
const MAX_CONSECUTIVE_SAME_CATEGORY = 3;

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

/**
 * Returns a 0–30 score for how well an article's difficulty matches the user's
 * level. `delta = articleRank - userRank`; positive = article is harder than
 * the user's level. Too-hard articles are penalised more steeply than
 * slightly-easy ones (per spec), so the user always gets readable content
 * ahead of content that's a stretch.
 */
export function levelProximityScore(articleRank: number, userRank: number): number {
  const delta = articleRank - userRank;
  if (delta === 0) return 30; // perfect match
  if (delta === -1) return 18; // slightly easy  — minor penalty
  if (delta === -2) return 10; // easy            — moderate penalty
  if (delta <= -3) return 5; //  way too easy    — large penalty (but still shown)
  if (delta === 1) return 12; // slightly hard   — bigger penalty than slightly easy
  if (delta === 2) return 3; //  hard            — strong penalty
  return 0; //                  way too hard    — still shown via fallback base
}

/**
 * Returns a 0–10 freshness bonus based on how recently the article was published.
 */
export function freshnessScore(publishedAt: Date | null, now: Date): number {
  if (!publishedAt) return 0;
  const ageDays = (now.getTime() - publishedAt.getTime()) / 86_400_000;
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 180) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Tag map helper
// ---------------------------------------------------------------------------

type ArticleTagRow = { articleId: string; tag: { slug: string } };

/**
 * Builds a map of `articleId → tag slugs[]` from a flat list of ArticleTag
 * join rows (the shape returned by a single `prisma.articleTag.findMany`).
 */
export function buildTagMap(rows: ArticleTagRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.articleId);
    if (existing) {
      existing.push(row.tag.slug);
    } else {
      map.set(row.articleId, [row.tag.slug]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Article scorer
// ---------------------------------------------------------------------------

export type ScoredArticle = {
  article: Article;
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
  article: Article,
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
 * No migration required — ranking is computed over existing columns
 * (category, difficulty, publishedAt) + joined ReadingProgress/ArticleTag data.
 */
export async function getPersonalizedFeed(
  userId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<FeedPage> {
  const limit = opts.limit ?? FEED_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const now = new Date();

  // 1) Load user profile (non-fatal on missing)
  const profile = await getProfile(userId);
  const hasProfile = Boolean(profile?.completedAt);

  // 2) Fetch all published articles (newest-first; capped for memory safety)
  const allArticles = await prisma.article.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_FETCH,
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

  // 3) Fill in missing difficulty assessments READ-ONLY (heuristic, no DB writes).
  // The processing pipeline writes difficulty during ingestion; we never write
  // from a GET path to avoid write-amplification on every feed request.
  for (const article of allArticles) {
    if (!isDifficultyLevel(article.difficulty)) {
      const h = heuristicDifficulty(article.content);
      article.difficulty = h.level;
      article.difficultyScore = h.score;
    }
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

  // 4) Batch-load reading progress (one query — no N+1)
  const progressRows = await prisma.readingProgress.findMany({
    where: { userId, articleId: { in: articleIds } },
    select: { articleId: true, completed: true, percent: true },
  });

  const completedIds = new Set<string>();
  const inProgressIds = new Set<string>();
  for (const row of progressRows) {
    if (row.completed) {
      completedIds.add(row.articleId);
    } else if (row.percent > 0) {
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
