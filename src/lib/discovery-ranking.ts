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

/** Shape of a single ArticleTag join row fetched from Prisma. */
export type ArticleTagRow = { articleId: string; tag: { slug: string } };

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
  if (delta === 0) return 30; // perfect match
  if (delta === -1) return 18; // slightly easy  — minor penalty
  if (delta === -2) return 10; // easy            — moderate penalty
  if (delta <= -3) return 5; //  way too easy    — large penalty (but still shown)
  if (delta === 1) return 12; // slightly hard   — bigger penalty than slightly easy
  if (delta === 2) return 3; //  hard            — strong penalty
  return 0; //                  way too hard    — still shown via fallback base
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
  if (articleRank == null || articleRank < 0 || userRank == null) return 0.5;
  const delta = articleRank - userRank;
  switch (delta) {
    case 0:
      return 1;
    case -1:
      return 0.78;
    case 1:
      return 0.62;
    case -2:
      return 0.5;
    case 2:
      return 0.32;
    default:
      return delta < 0 ? 0.2 : 0.12;
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
  const ageDays = (now.getTime() - publishedAt.getTime()) / 86_400_000;
  if (ageDays <= 7) return 10;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 4;
  if (ageDays <= 180) return 2;
  return 0;
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
  const ageDays =
    (now.getTime() - new Date(publishedAt).getTime()) / 86_400_000;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.75;
  if (ageDays <= 90) return 0.5;
  if (ageDays <= 180) return 0.3;
  return 0.1;
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
