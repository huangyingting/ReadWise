/**
 * Discovery-ranking shared primitives — REF-017.
 *
 * Reusable, PURE scoring components for the feed and recommendation engines.
 * Each caller keeps its own weight profile and page-building logic; this module
 * owns the underlying signal computations so future calibration changes are made
 * in one place rather than diverging across callers.
 *
 * Weight profiles:
 *   - Feed (`feed.ts`): integer-scale weights — uses `levelProximityScore`
 *     (0–30) and `freshnessScore` (0–10).
 *   - Scored picks (`recommendations.ts`): normalised 0–1 components — uses
 *     `levelFitScore` and `freshnessScore01`.
 *
 * All functions are PURE (no DB / no I/O) and independent of Prisma so they
 * are unit-testable in isolation.
 */

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

const LEVEL_PROXIMITY_SCORES = {
  exact: 30,
  slightlyEasy: 18,
  easy: 10,
  tooEasy: 5,
  slightlyHard: 12,
  hard: 3,
  tooHard: 0,
} as const;

const LEVEL_FIT_SCORES = {
  unknown: 0.5,
  exact: 1,
  slightlyEasy: 0.78,
  slightlyHard: 0.62,
  easy: 0.5,
  hard: 0.32,
  tooEasy: 0.2,
  tooHard: 0.12,
} as const;

/** Shape of a single ArticleTag join row fetched from Prisma. */
export type ArticleTagRow = { articleId: string; tag: { slug: string } };

function daysBetween(now: Date, publishedAt: Date | string): number {
  return (now.getTime() - new Date(publishedAt).getTime()) / MS_PER_DAY;
}

function scoreByAge(
  ageDays: number,
  thresholds: readonly [maxAgeDays: number, score: number][],
  fallback: number,
): number {
  for (const [maxAgeDays, score] of thresholds) {
    if (ageDays <= maxAgeDays) return score;
  }
  return fallback;
}

/**
 * Builds a `Map<articleId, slugs[]>` from a flat list of ArticleTag join rows
 * (the shape returned by a single `prisma.articleTag.findMany`). Avoids
 * repeated O(n) scans when tagging many articles at once.
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
// CEFR proximity — feed weight profile (0–30)
// ---------------------------------------------------------------------------

/**
 * Returns a 0–30 score for how well an article's difficulty matches the user's
 * level. `delta = articleRank - userRank`; positive = article is harder than
 * the user's level. Too-hard articles are penalised more steeply than
 * slightly-easy ones, so the user always gets readable content ahead of
 * content that is a stretch.
 *
 * Used by the feed engine with its integer-scale `SCORE_WEIGHTS` profile.
 */
export function levelProximityScore(articleRank: number, userRank: number): number {
  const delta = articleRank - userRank;
  if (delta === 0) return LEVEL_PROXIMITY_SCORES.exact;
  if (delta === -1) return LEVEL_PROXIMITY_SCORES.slightlyEasy;
  if (delta === -2) return LEVEL_PROXIMITY_SCORES.easy;
  if (delta <= -3) return LEVEL_PROXIMITY_SCORES.tooEasy;
  if (delta === 1) return LEVEL_PROXIMITY_SCORES.slightlyHard;
  if (delta === 2) return LEVEL_PROXIMITY_SCORES.hard;
  return LEVEL_PROXIMITY_SCORES.tooHard;
}

// ---------------------------------------------------------------------------
// CEFR proximity — recommendation weight profile (0–1)
// ---------------------------------------------------------------------------

/**
 * CEFR proximity (0–1). Perfect match = 1; too-hard is penalised more steeply
 * than slightly-easy so readers always get accessible content first. Returns a
 * neutral 0.5 when either rank is unknown.
 *
 * Used by the recommendation engine with its normalised `COMPONENT_WEIGHTS`
 * profile.
 */
export function levelFitScore(
  articleRank: number | null,
  userRank: number | null,
): number {
  if (articleRank == null || articleRank < 0 || userRank == null) {
    return LEVEL_FIT_SCORES.unknown;
  }

  const delta = articleRank - userRank;
  switch (delta) {
    case 0:
      return LEVEL_FIT_SCORES.exact;
    case -1:
      return LEVEL_FIT_SCORES.slightlyEasy;
    case 1:
      return LEVEL_FIT_SCORES.slightlyHard;
    case -2:
      return LEVEL_FIT_SCORES.easy;
    case 2:
      return LEVEL_FIT_SCORES.hard;
    default:
      return delta < 0 ? LEVEL_FIT_SCORES.tooEasy : LEVEL_FIT_SCORES.tooHard;
  }
}

// ---------------------------------------------------------------------------
// Freshness — feed weight profile (0–10)
// ---------------------------------------------------------------------------

/**
 * Returns a 0–10 freshness bonus based on how recently the article was
 * published. Used by the feed engine with its integer-scale `SCORE_WEIGHTS`
 * profile.
 */
export function freshnessScore(publishedAt: Date | null, now: Date): number {
  if (!publishedAt) return 0;
  return scoreByAge(
    daysBetween(now, publishedAt),
    [
      [7, 10],
      [30, 7],
      [90, 4],
      [180, 2],
    ],
    0,
  );
}

// ---------------------------------------------------------------------------
// Freshness — recommendation weight profile (0–1)
// ---------------------------------------------------------------------------

/**
 * Content freshness (0–1) from how recently the article was published.
 * Accepts ISO strings as well as `Date` objects (cached rows may arrive as
 * strings). Used by the recommendation engine with its normalised
 * `COMPONENT_WEIGHTS` profile.
 */
export function freshnessScore01(
  publishedAt: Date | string | null,
  now: Date,
): number {
  if (!publishedAt) return 0.1;
  return scoreByAge(
    daysBetween(now, publishedAt),
    [
      [7, 1],
      [30, 0.75],
      [90, 0.5],
      [180, 0.3],
    ],
    0.1,
  );
}

// ---------------------------------------------------------------------------
// Topic interest — recommendation weight profile (0–1)
// ---------------------------------------------------------------------------

/**
 * Topic interest (0–1) from the article's category + tags vs the user's topics.
 * A category match is full credit; otherwise each matching tag adds 0.4 (capped
 * at 0.8). Returns a neutral 0.5 when the user has selected no topics.
 *
 * Used by the recommendation engine. The feed engine applies a separate
 * integer-scale scoring pass (see `SCORE_WEIGHTS` in `feed.ts`).
 */
export function topicInterestScore(
  category: string | null,
  tagSlugs: string[],
  topicSet: Set<string>,
): number {
  if (topicSet.size === 0) return 0.5;
  if (category && topicSet.has(category)) return 1;
  const matches = tagSlugs.filter((slug) => topicSet.has(slug)).length;
  if (matches > 0) return Math.min(0.8, 0.4 + (matches - 1) * 0.4);
  return 0;
}
