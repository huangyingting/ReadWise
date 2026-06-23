/**
 * Transparent recommendation scoring engine — RW-039.
 *
 * Ranks candidate articles for a user by combining several deterministic,
 * inspectable component sub-scores (each 0–1):
 *
 *   - levelFit            CEFR distance to the user's (adaptive) level
 *   - topicInterest       profile topic / tag match
 *   - novelty             unread / not recently engaged
 *   - difficultyFeedback  nudge from the user's too_easy/too_hard history
 *   - masteryGap          room-to-learn from article/skill mastery
 *   - wordLoad            comfortable unknown-word load vs WordMastery
 *   - freshness           content recency (publishedAt)
 *
 * plus a DIVERSITY pass that avoids repeatedly surfacing the same category.
 *
 * Every result carries its component sub-scores AND a human-readable reason /
 * explanation, both for debugging and optional user-facing transparency. The
 * scoring helpers are PURE (no DB) so they are unit-testable in isolation;
 * {@link buildRecommendationContext} is the only DB-touching function.
 *
 * Integration: {@link listScoredPicksPage} powers the personalized "Picks" feed
 * (browse + /api/articles). The user-agnostic candidate fetch is cached via
 * {@link createCachedListing}; the per-user scoring runs OUTSIDE the cache so
 * shared cache entries never leak one user's mastery into another's.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  isDifficultyLevel,
  levelRank,
  levelsAtOrBelow,
  type DifficultyLevel,
} from "@/lib/difficulty";
import { getProfile, parseTopics } from "@/lib/profile";
import {
  toListingArticle,
  readingMinutesFor,
  type ArticleCardSource,
  type ListingArticle,
} from "@/lib/articles";
import { publicListableArticleWhere } from "@/lib/article-access";
import {
  createCachedListing,
  ARTICLES_CACHE_TAG,
  TAGS_CACHE_TAG,
} from "@/lib/cache";
import { getAdaptiveLevelRecommendation } from "@/lib/leveling";
import { getSkillProfile, type Skill } from "@/lib/skill-mastery";
import { clamp01 } from "@/lib/mastery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One candidate article to be scored. Body/content is never needed here. */
export type RecommendationCandidate = ArticleCardSource & {
  /** Tag slugs for topic matching (optional — empty when unknown). */
  tagSlugs?: string[];
};

/** The seven component sub-scores (each 0–1). */
export type ScoreComponents = {
  levelFit: number;
  topicInterest: number;
  novelty: number;
  difficultyFeedback: number;
  masteryGap: number;
  wordLoad: number;
  freshness: number;
};

export type ScoredRecommendation = {
  id: string;
  category: string | null;
  /** Final 0–100 score AFTER the diversity penalty. */
  score: number;
  /** 0–100 weighted score BEFORE the diversity penalty. */
  baseScore: number;
  /** Points removed by the diversity pass (0 when not penalised). */
  diversityPenalty: number;
  components: ScoreComponents;
  /** Short headline reason (the dominant component). */
  reason: string;
  /** Detailed, per-component human-readable notes. */
  explanation: string[];
};

/** All per-user signals needed to score candidates. Built once per request. */
export type RecommendationContext = {
  userLevel: DifficultyLevel | null;
  userLevelRank: number | null;
  topicSet: Set<string>;
  completedIds: Set<string>;
  inProgressPercent: Map<string, number>;
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>;
  /** −1…+1 from difficulty feedback (neg = prefers easier). */
  difficultyBias: number;
  weakestSkill: Skill | null;
  vocab: { avgFamiliarity: number; knownCount: number };
  now: Date;
};

// ---------------------------------------------------------------------------
// Weights (exported so tests / debugging can reference them)
// ---------------------------------------------------------------------------

export const COMPONENT_WEIGHTS: Record<keyof ScoreComponents, number> = {
  levelFit: 0.26,
  topicInterest: 0.2,
  masteryGap: 0.14,
  novelty: 0.12,
  wordLoad: 0.12,
  freshness: 0.08,
  difficultyFeedback: 0.08,
};

/** Points removed per prior same-category pick during the diversity pass. */
const DIVERSITY_STEP = 6;
/** Maximum diversity penalty applied to any single article. */
const DIVERSITY_MAX_PENALTY = 18;

/** Safety cap: maximum candidate articles fetched for in-memory ranking. */
const MAX_CANDIDATES = 400;

/** Default page size for the scored picks feed. */
export const SCORED_PICKS_PAGE_SIZE = 6;

// ---------------------------------------------------------------------------
// Pure component scorers
// ---------------------------------------------------------------------------

/** Clamps a CEFR delta into the [-3, 3] band used by the scorers. */
function clampDelta(delta: number): number {
  return Math.max(-3, Math.min(3, delta));
}

/**
 * CEFR proximity (0–1). Perfect match = 1; too-hard is penalised more steeply
 * than slightly-easy so readers always get accessible content first. Returns a
 * neutral 0.5 when either rank is unknown.
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

/**
 * Topic interest (0–1) from the article's category + tags vs the user's topics.
 * A category match is full credit; otherwise each matching tag adds 0.4 (capped
 * at 0.8). Returns a neutral 0.5 when the user has selected no topics.
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

/**
 * Novelty (0–1). Completed articles score 0 (nothing new); in-progress 0.45;
 * articles seen recently (have mastery activity) decay by recency; never-seen
 * articles score 1.
 */
export function noveltyScore(
  articleId: string,
  completedIds: Set<string>,
  inProgressPercent: Map<string, number>,
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>,
  now: Date,
): number {
  if (completedIds.has(articleId)) return 0;
  const percent = inProgressPercent.get(articleId);
  if (percent != null && percent > 0) return 0.45;
  const mastery = masteryByArticle.get(articleId);
  if (mastery) {
    const ageDays =
      (now.getTime() - new Date(mastery.lastActivityAt).getTime()) / 86_400_000;
    if (ageDays <= 3) return 0.3;
    if (ageDays <= 14) return 0.6;
    return 0.85;
  }
  return 1;
}

/**
 * Difficulty-feedback nudge (0–1). Rewards articles whose difficulty aligns
 * with the direction the user's feedback prefers: when `bias` is negative
 * (keeps finding things too hard) easier articles score higher, and vice versa.
 * Neutral 0.5 at a perfect level match or when there is no bias.
 */
export function difficultyFeedbackScore(
  articleRank: number | null,
  userRank: number | null,
  bias: number,
): number {
  if (articleRank == null || articleRank < 0 || userRank == null) return 0.5;
  const delta = clampDelta(articleRank - userRank);
  // bias>0 wants harder (positive delta good); bias<0 wants easier.
  return clamp01(0.5 + 0.2 * bias * delta);
}

/**
 * Comfortable unknown-word load (0–1) from the article's level relative to the
 * user and their overall WordMastery strength. Peaks at a moderate expected
 * load (a worthwhile but not overwhelming number of new words).
 */
export function wordLoadScore(
  articleRank: number | null,
  userRank: number | null,
  vocab: { avgFamiliarity: number; knownCount: number },
): number {
  const delta =
    articleRank == null || articleRank < 0 || userRank == null
      ? 0
      : clampDelta(articleRank - userRank);
  const vocabStrength = clamp01(
    0.5 * clamp01(vocab.avgFamiliarity) + 0.5 * Math.min(1, vocab.knownCount / 200),
  );
  // Higher = more expected unknown words. Harder-than-user raises it; a strong
  // vocabulary lowers it.
  const expectedLoad = clamp01(0.35 + 0.18 * delta - 0.25 * vocabStrength);
  // Comfort peaks around a 0.3 load; fall off in both directions.
  return clamp01(1 - Math.abs(expectedLoad - 0.3) / 0.7);
}

/** Content freshness (0–1) from how recently the article was published. */
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

/**
 * Mastery-gap opportunity (0–1). High when there is room to learn (article not
 * yet well understood / unread), with a small boost when the article targets
 * the user's weakest skill: consolidating reading/comprehension favours
 * at-or-below level, while building vocabulary favours at-or-slightly-above.
 */
export function masteryGapScore(
  articleId: string,
  articleRank: number | null,
  userRank: number | null,
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>,
  weakestSkill: Skill | null,
): number {
  const mastery = masteryByArticle.get(articleId);
  let gap = mastery ? 1 - clamp01(mastery.comprehensionScore) : 0.7;

  if (weakestSkill && articleRank != null && articleRank >= 0 && userRank != null) {
    const delta = articleRank - userRank;
    if (
      (weakestSkill === "reading" || weakestSkill === "comprehension") &&
      delta <= 0
    ) {
      gap += 0.15;
    } else if (
      (weakestSkill === "vocabulary" || weakestSkill === "grammar") &&
      delta >= 0 &&
      delta <= 1
    ) {
      gap += 0.15;
    }
  }
  return clamp01(gap);
}

// ---------------------------------------------------------------------------
// Candidate scorer
// ---------------------------------------------------------------------------

const COMPONENT_LABELS: Record<keyof ScoreComponents, string> = {
  levelFit: "level fit",
  topicInterest: "topic interest",
  novelty: "novelty",
  difficultyFeedback: "difficulty feedback",
  masteryGap: "learning opportunity",
  wordLoad: "vocabulary load",
  freshness: "freshness",
};

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function headlineReason(
  candidate: RecommendationCandidate,
  components: ScoreComponents,
  ctx: RecommendationContext,
): string {
  // The dominant WEIGHTED contribution drives the headline.
  let topKey: keyof ScoreComponents = "freshness";
  let topVal = -Infinity;
  for (const key of Object.keys(components) as Array<keyof ScoreComponents>) {
    const weighted = components[key] * COMPONENT_WEIGHTS[key];
    if (weighted > topVal) {
      topVal = weighted;
      topKey = key;
    }
  }

  switch (topKey) {
    case "topicInterest":
      return candidate.category
        ? `Matches your interest in ${titleCase(candidate.category)}`
        : "Matches your interests";
    case "levelFit":
      return ctx.userLevel
        ? `Right for your ${ctx.userLevel} level`
        : "A good reading-level match";
    case "novelty":
      return "New to you";
    case "masteryGap":
      return ctx.weakestSkill
        ? `Helps build your ${ctx.weakestSkill}`
        : "A fresh learning opportunity";
    case "wordLoad":
      return "A comfortable vocabulary stretch";
    case "difficultyFeedback":
      return ctx.difficultyBias < 0
        ? "Easier, matching your recent feedback"
        : "A bit more challenging, as you asked";
    default:
      return "Freshly published";
  }
}

/**
 * Scores a single candidate for a user. PURE — all per-user signals come from
 * `ctx`. Diversity is applied later (see {@link rankWithDiversity}).
 */
export function scoreCandidate(
  candidate: RecommendationCandidate,
  ctx: RecommendationContext,
): ScoredRecommendation {
  const articleRank =
    candidate.difficulty && isDifficultyLevel(candidate.difficulty)
      ? levelRank(candidate.difficulty)
      : null;
  const tagSlugs = candidate.tagSlugs ?? [];

  const components: ScoreComponents = {
    levelFit: levelFitScore(articleRank, ctx.userLevelRank),
    topicInterest: topicInterestScore(candidate.category, tagSlugs, ctx.topicSet),
    novelty: noveltyScore(
      candidate.id,
      ctx.completedIds,
      ctx.inProgressPercent,
      ctx.masteryByArticle,
      ctx.now,
    ),
    difficultyFeedback: difficultyFeedbackScore(
      articleRank,
      ctx.userLevelRank,
      ctx.difficultyBias,
    ),
    masteryGap: masteryGapScore(
      candidate.id,
      articleRank,
      ctx.userLevelRank,
      ctx.masteryByArticle,
      ctx.weakestSkill,
    ),
    wordLoad: wordLoadScore(articleRank, ctx.userLevelRank, ctx.vocab),
    freshness: freshnessScore01(candidate.publishedAt ?? null, ctx.now),
  };

  let weighted = 0;
  for (const key of Object.keys(components) as Array<keyof ScoreComponents>) {
    weighted += components[key] * COMPONENT_WEIGHTS[key];
  }
  const baseScore = Math.round(weighted * 1000) / 10; // 0–100, 1dp

  const explanation = (Object.keys(components) as Array<keyof ScoreComponents>)
    .map(
      (key) =>
        `${COMPONENT_LABELS[key]}: ${Math.round(components[key] * 100)}% (weight ${COMPONENT_WEIGHTS[key]})`,
    );

  return {
    id: candidate.id,
    category: candidate.category ?? null,
    score: baseScore,
    baseScore,
    diversityPenalty: 0,
    components,
    reason: headlineReason(candidate, components, ctx),
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Diversity-aware ranking
// ---------------------------------------------------------------------------

/**
 * Greedy diversity-aware ordering. Repeatedly selects the highest-scoring
 * remaining article, applying an increasing penalty to categories already
 * picked so the same category isn't surfaced over and over. The penalty is
 * recorded on each result and folded into its final `score`. Stable: ties keep
 * the incoming (score-desc) order.
 */
export function rankWithDiversity(
  scored: ScoredRecommendation[],
): ScoredRecommendation[] {
  const remaining = [...scored].sort((a, b) => b.baseScore - a.baseScore);
  const result: ScoredRecommendation[] = [];
  const categoryCount = new Map<string, number>();

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cat = remaining[i].category ?? "";
      const seen = cat ? categoryCount.get(cat) ?? 0 : 0;
      const penalty = Math.min(DIVERSITY_MAX_PENALTY, seen * DIVERSITY_STEP);
      const eff = remaining[i].baseScore - penalty;
      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    const cat = picked.category ?? "";
    const seen = cat ? categoryCount.get(cat) ?? 0 : 0;
    const penalty = Math.min(DIVERSITY_MAX_PENALTY, seen * DIVERSITY_STEP);
    picked.diversityPenalty = penalty;
    picked.score = Math.max(0, Math.round((picked.baseScore - penalty) * 10) / 10);
    if (penalty > 0) {
      picked.explanation.push(`diversity: −${penalty} (category already shown)`);
    }
    if (cat) categoryCount.set(cat, seen + 1);
    result.push(picked);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Context builder (DB)
// ---------------------------------------------------------------------------

/**
 * Loads every per-user signal needed to score the given candidates. Degrades
 * gracefully for a brand-new user (no profile / no mastery): level + topic
 * become neutral, every article reads as novel, and bias/vocab are empty.
 */
export async function buildRecommendationContext(
  userId: string,
  candidateIds: string[],
  now: Date = new Date(),
): Promise<RecommendationContext> {
  const [profile, adaptive, skillProfile, vocabAgg, progressRows, masteryRows] =
    await Promise.all([
      getProfile(userId),
      getAdaptiveLevelRecommendation(userId),
      getSkillProfile(userId),
      prisma.wordMastery.aggregate({
        where: { userId },
        _avg: { familiarity: true },
        _count: { _all: true },
      }),
      candidateIds.length > 0
        ? prisma.readingProgress.findMany({
            where: { userId, articleId: { in: candidateIds } },
            select: { articleId: true, percent: true, completed: true },
          })
        : Promise.resolve([] as Array<{ articleId: string; percent: number; completed: boolean }>),
      candidateIds.length > 0
        ? prisma.articleMastery.findMany({
            where: { userId, articleId: { in: candidateIds } },
            select: { articleId: true, comprehensionScore: true, lastActivityAt: true },
          })
        : Promise.resolve(
            [] as Array<{ articleId: string; comprehensionScore: number; lastActivityAt: Date }>,
          ),
    ]);

  // The adaptive recommendation already factors feedback + quiz + skills, so
  // its `recommendedLevel` is the level the engine should centre on.
  const userLevel: DifficultyLevel | null = adaptive
    ? adaptive.recommendedLevel
    : isDifficultyLevel(profile?.englishLevel)
      ? profile.englishLevel
      : null;
  const userLevelRank = userLevel ? levelRank(userLevel) : null;

  const completedIds = new Set<string>();
  const inProgressPercent = new Map<string, number>();
  for (const row of progressRows) {
    if (row.completed) completedIds.add(row.articleId);
    else if (row.percent > 0) inProgressPercent.set(row.articleId, row.percent);
  }

  const masteryByArticle = new Map<
    string,
    { comprehensionScore: number; lastActivityAt: Date }
  >();
  for (const row of masteryRows) {
    masteryByArticle.set(row.articleId, {
      comprehensionScore: row.comprehensionScore,
      lastActivityAt: row.lastActivityAt,
    });
  }

  return {
    userLevel,
    userLevelRank,
    topicSet: new Set(parseTopics(profile?.topics)),
    completedIds,
    inProgressPercent,
    masteryByArticle,
    difficultyBias: adaptive?.difficultyBias ?? 0,
    weakestSkill: skillProfile.weakest,
    vocab: {
      avgFamiliarity: vocabAgg._avg.familiarity ?? 0,
      knownCount: vocabAgg._count._all ?? 0,
    },
    now,
  };
}

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

// ---------------------------------------------------------------------------
// Candidate fetch (cached, user-agnostic) + scored picks page
// ---------------------------------------------------------------------------

/** Article + tag fields needed to score and render a picks candidate. */
type PicksCandidateRow = ArticleCardSource & { tagSlugs: string[] };

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
  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagMap.get(row.articleId);
    if (list) list.push(row.tag.slug);
    else tagMap.set(row.articleId, [row.tag.slug]);
  }

  return rows.map((r) => ({ ...r, tagSlugs: tagMap.get(r.id) ?? [] }));
}

/**
 * Cached, user-agnostic candidate set for the picks feed (keyed by the level
 * cap). Safe to cache because it carries no per-user data; the per-user scoring
 * happens afterwards, outside the cache.
 */
const loadPicksCandidates = createCachedListing(
  loadPicksCandidatesImpl,
  ["recommendations:picks-candidates"],
  [ARTICLES_CACHE_TAG, TAGS_CACHE_TAG],
);

export type ScoredPicksPage = {
  articles: ListingArticle[];
  hasMore: boolean;
  /** articleId → headline reason (parallel to `articles`). */
  reasons: Record<string, string>;
  /** articleId → full scored result (component sub-scores + explanation). */
  scored: Record<string, ScoredRecommendation>;
};

/**
 * Personalized, transparently-scored "Picks" feed. Fetches a cached candidate
 * set (optionally capped at `maxLevel`), scores + diversity-ranks it for the
 * user, then paginates. The same `maxLevel`/`topics` contract as the legacy
 * {@link import("@/lib/articles").listPicksPage} so it is a drop-in upgrade.
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
