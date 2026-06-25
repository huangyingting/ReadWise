/**
 * Cached picks loading and paginated scored-picks feed — REF-010.
 *
 * Owns the cache-first, user-agnostic candidate fetch (Prisma + Next.js cache)
 * and the per-user scoring/pagination pass that produces the personalized
 * "Picks" feed. The candidate cache carries no per-user data so it is safe to
 * share across requests; per-user scoring runs outside the cache boundary.
 */

import type { Prisma } from "@prisma/client";
import { levelsAtOrBelow, type DifficultyLevel } from "@/lib/difficulty";
import {
  toListingArticle,
  readingMinutesFor,
  type ArticleCardSource,
  type ListingArticle,
} from "@/lib/article-library";
import { publicListableArticleWhere } from "@/lib/article-library";
import {
  createCachedListing,
  ARTICLES_CACHE_TAG,
  TAGS_CACHE_TAG,
} from "@/lib/cache";
import { LISTING_KEYS } from "@/lib/listing-cache";
import { prisma } from "@/lib/prisma";
import { buildTagMap } from "@/lib/discovery-ranking";
import { scoreCandidate } from "./scoring";
import { rankWithDiversity } from "./diversity";
import { buildRecommendationContext } from "./context";
import type { RecommendationCandidate, ScoredRecommendation } from "./types";

// ---------------------------------------------------------------------------
// Candidate fetch (cached, user-agnostic)
// ---------------------------------------------------------------------------

/** Article + tag fields needed to score and render a picks candidate. */
type PicksCandidateRow = ArticleCardSource & { tagSlugs: string[] };

/** Safety cap: maximum candidate articles fetched for in-memory ranking. */
const MAX_CANDIDATES = 400;

/** Default page size for the scored picks feed. */
export const SCORED_PICKS_PAGE_SIZE = 6;

const PICKS_SELECT = {
  id: true,
  title: true,
  author: true,
  source: true,
  category: true,
  difficulty: true,
  readingMinutes: true,
  wordCount: true,
  publishedAt: true,
  heroImage: true,
} satisfies Prisma.ArticleSelect;

async function loadPicksCandidatesImpl(
  cap: DifficultyLevel | null,
): Promise<PicksCandidateRow[]> {
  const where = publicListableArticleWhere(
    cap ? { difficulty: { in: levelsAtOrBelow(cap) } } : undefined,
  );
  const rows = await prisma.article.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_CANDIDATES,
    select: PICKS_SELECT,
  });
  if (rows.length === 0) return [];

  const tagRows = await prisma.articleTag.findMany({
    where: { articleId: { in: rows.map((r) => r.id) } },
    select: { articleId: true, tag: { select: { slug: true } } },
  });
  const tagMap = buildTagMap(tagRows);

  return rows.map((r) => ({ ...r, tagSlugs: tagMap.get(r.id) ?? [] }));
}

/**
 * Cached, user-agnostic candidate set for the picks feed (keyed by the level
 * cap). Safe to cache because it carries no per-user data; the per-user scoring
 * happens afterwards, outside the cache.
 */
const loadPicksCandidates = createCachedListing(
  loadPicksCandidatesImpl,
  LISTING_KEYS.picksCandidates,
  [ARTICLES_CACHE_TAG, TAGS_CACHE_TAG],
);

// ---------------------------------------------------------------------------
// Scored picks page
// ---------------------------------------------------------------------------

export type ScoredPicksPage = {
  articles: ListingArticle[];
  hasMore: boolean;
  /** articleId → headline reason (parallel to `articles`). */
  reasons: Record<string, string>;
  /** articleId → full scored result (component sub-scores + explanation). */
  scored: Record<string, ScoredRecommendation>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scores AND ranks (diversity-aware) the given candidates for a user. Returns
 * results sorted best-first, each carrying its component sub-scores + reason.
 */
export async function scoreAndRankArticles(
  userId: string,
  candidates: RecommendationCandidate[],
  now: Date = new Date(),
): Promise<ScoredRecommendation[]> {
  if (candidates.length === 0) return [];
  const ctx = await buildRecommendationContext(
    userId,
    candidates.map((c) => c.id),
    now,
  );
  const scored = candidates.map((c) => scoreCandidate(c, ctx));
  return rankWithDiversity(scored);
}

/**
 * Personalized, transparently-scored "Picks" feed. Fetches a cached candidate
 * set (optionally capped at `maxLevel`), scores + diversity-ranks it for the
 * user, then paginates. Preserves the same `maxLevel`/`topics` contract as the
 * legacy picks feed so it is a drop-in upgrade.
 */
export async function listScoredPicksPage(
  userId: string,
  opts: {
    maxLevel?: DifficultyLevel | null;
    topics?: string[];
    offset?: number;
    limit?: number;
  } = {},
): Promise<ScoredPicksPage> {
  const limit = opts.limit ?? SCORED_PICKS_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const cap = opts.maxLevel ?? null;

  const candidates = await loadPicksCandidates(cap);
  const ranked = await scoreAndRankArticles(userId, candidates);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const pageScored = ranked.slice(offset, offset + limit);

  const articles: ListingArticle[] = [];
  const reasons: Record<string, string> = {};
  const scored: Record<string, ScoredRecommendation> = {};
  for (const item of pageScored) {
    const row = byId.get(item.id);
    if (!row) continue;
    articles.push(toListingArticle({ ...row, readingMinutes: readingMinutesFor(row) }));
    reasons[item.id] = item.reason;
    scored[item.id] = item;
  }

  return {
    articles,
    hasMore: offset + limit < ranked.length,
    reasons,
    scored,
  };
}
