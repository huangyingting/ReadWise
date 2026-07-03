/**
 * Goal Paths (#809) — deterministic, no-AI reading-strategy tuning.
 *
 * A learner may pick a `goalPath` on their `Profile` (controlled enum string).
 * It tunes recommendation scoring as a SOFT, capped nudge and selects
 * path-specific, deterministic Today/comprehension copy. There is NO AI here
 * and NO inference of a learner's goal from history: only the controlled string
 * the learner explicitly selected is ever read or stored.
 *
 * Privacy: this module is pure. It reads article metadata (length / difficulty /
 * topic slugs) and the controlled `goalPath` string only — never article body
 * text, titles, prompts, definitions, or any other learning content.
 */

import { isDifficultyLevel, levelRank } from "@/lib/leveling/cefr-primitives";

// ---------------------------------------------------------------------------
// Controlled values + validator
// ---------------------------------------------------------------------------

/** The initial set of goal paths (design §3, #809). */
export const GOAL_PATHS = [
  "daily_news",
  "academic",
  "business",
  "exam",
  "extensive",
] as const;

/** One controlled goal-path value. `null` means "not set" (level-only scoring). */
export type GoalPath = (typeof GOAL_PATHS)[number];

/** Type guard: true only for a controlled goal-path string. */
export function isGoalPath(value: unknown): value is GoalPath {
  return (
    typeof value === "string" &&
    (GOAL_PATHS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Tuning constants (the multiplier table — design §3)
// ---------------------------------------------------------------------------

/**
 * Maximum additive nudge (in normalised 0–1 score units) the goal-path
 * adjustment may apply, in either direction. Intentionally small so path tuning
 * remains a soft nudge that never overrides the core seven-component score.
 */
export const GOAL_PATH_ADJUSTMENT_CAP = 0.2;

/**
 * Minimum number of candidates a path must "fit" before its tuning is applied.
 * Below this the content-starvation guard relaxes tuning to standard scoring so
 * the feed is never starved (design §3 acceptance criteria).
 */
export const GOAL_PATH_MIN_CANDIDATES = 2;

const LENGTH_FIT_BONUS = 0.05;
const LENGTH_OVERSHOOT_PENALTY = 0.1;
const DIFFICULTY_BAND_BONUS = 0.05;
const DIFFICULTY_OVERSHOOT_PENALTY = 0.08;
const TOPIC_BOOST_DELTA_SCALE = 0.2;

/** Per-path deterministic tuning constants. */
export type GoalPathTuning = {
  /** Soft preferred maximum article length, in words. */
  maxLengthWords: number;
  /**
   * Inclusive preferred CEFR rank band [min, max] (A1=0 … C2=5). Articles in
   * band earn a small boost; articles above band are softly penalised, scaled
   * by {@link overshootTolerance}.
   */
  preferredBand: [number, number];
  /**
   * Difficulty-overshoot tolerance from the design table. Higher = more lenient
   * about articles harder than the band; lower/negative = stricter penalty.
   */
  overshootTolerance: number;
  /** Topic interest weight boosts keyed by category/tag slug (multiplier). */
  topicBoosts: Record<string, number>;
  /** Deterministic comprehension-prompt copy key for this path. */
  comprehensionCopyKey: string;
};

/**
 * The tuning table (design §3). Length / band / tolerance / topic boosts /
 * comprehension copy per path. Constants only — applied by the pure functions
 * below, never via DB or AI.
 */
export const GOAL_PATH_TUNING: Record<GoalPath, GoalPathTuning> = {
  daily_news: {
    maxLengthWords: 600,
    preferredBand: [levelRank("B1"), levelRank("B2")],
    overshootTolerance: 0.5,
    topicBoosts: { current_events: 1.3, news: 1.3 },
    comprehensionCopyKey: "main_idea",
  },
  academic: {
    maxLengthWords: 1200,
    preferredBand: [levelRank("B2"), levelRank("C1")],
    overshootTolerance: 1.0,
    topicBoosts: {},
    comprehensionCopyKey: "argument_structure",
  },
  business: {
    maxLengthWords: 900,
    preferredBand: [levelRank("B1"), levelRank("C1")],
    overshootTolerance: 0.5,
    topicBoosts: { business: 1.3, finance: 1.3, technology: 1.2 },
    comprehensionCopyKey: "key_takeaway",
  },
  exam: {
    maxLengthWords: 800,
    preferredBand: [levelRank("B1"), levelRank("B2")],
    overshootTolerance: 0.5,
    topicBoosts: {},
    comprehensionCopyKey: "comprehension_check",
  },
  extensive: {
    maxLengthWords: 500,
    preferredBand: [levelRank("A1"), levelRank("B1")],
    overshootTolerance: -0.5,
    topicBoosts: {},
    comprehensionCopyKey: "enjoyment",
  },
};

// ---------------------------------------------------------------------------
// Pure adjustment
// ---------------------------------------------------------------------------

/**
 * Minimal article shape the pure tuning needs. Metadata only — never body text.
 */
export type GoalPathArticle = {
  wordCount?: number | null;
  category?: string | null;
  difficulty?: string | null;
  tagSlugs?: string[];
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampCap(n: number): number {
  return Math.max(
    -GOAL_PATH_ADJUSTMENT_CAP,
    Math.min(GOAL_PATH_ADJUSTMENT_CAP, n),
  );
}

function lengthDelta(words: number | null, maxLengthWords: number): number {
  if (words == null || words <= 0) return 0;
  if (words <= maxLengthWords) return LENGTH_FIT_BONUS;

  const over = (words - maxLengthWords) / maxLengthWords;
  return -LENGTH_OVERSHOOT_PENALTY * Math.min(1, over);
}

function difficultyDelta(
  difficulty: string | null | undefined,
  tuning: GoalPathTuning,
): number {
  if (!difficulty || !isDifficultyLevel(difficulty)) return 0;

  const rank = levelRank(difficulty);
  const [minRank, maxRank] = tuning.preferredBand;
  if (rank >= minRank && rank <= maxRank) return DIFFICULTY_BAND_BONUS;
  if (rank <= maxRank) return 0;

  const aboveBy = rank - maxRank;
  return (
    -(DIFFICULTY_OVERSHOOT_PENALTY * aboveBy) /
    (1 + tuning.overshootTolerance)
  );
}

function bestTopicBoost(
  slugs: string[],
  topicBoosts: Record<string, number>,
): number {
  let bestBoost = 1;
  for (const slug of slugs) {
    const boost = topicBoosts[slug];
    if (boost && boost > bestBoost) bestBoost = boost;
  }
  return bestBoost;
}

function topicDelta(article: GoalPathArticle, tuning: GoalPathTuning): number {
  const slugs = [article.category ?? "", ...(article.tagSlugs ?? [])].filter(
    Boolean,
  );
  const boost = bestTopicBoost(slugs, tuning.topicBoosts);
  return boost > 1 ? (boost - 1) * TOPIC_BOOST_DELTA_SCALE : 0;
}

/**
 * Computes the raw, capped path nudge (in 0–1 score units) for one article.
 * Sums a length-fit, difficulty-band, and topic-boost signal, then clamps to
 * ±{@link GOAL_PATH_ADJUSTMENT_CAP}. PURE — article metadata + path only.
 */
export function goalPathDelta(article: GoalPathArticle, goalPath: GoalPath): number {
  const tuning = GOAL_PATH_TUNING[goalPath];

  // Length fit: within the soft max earns a small boost; overshoot is softly
  // penalised in proportion to how far past the max it runs.
  const length = lengthDelta(article.wordCount ?? null, tuning.maxLengthWords);

  // Difficulty band: in-band earns a small boost; above-band is penalised,
  // scaled by the path's overshoot tolerance (more tolerance → softer penalty).
  // Below band: neutral (easier-than-preferred is never penalised).
  const difficulty = difficultyDelta(article.difficulty, tuning);

  // Topic boost: a preferred category/tag slug earns a boost proportional to
  // its configured multiplier (e.g. ×1.3 → +0.06).
  const topic = topicDelta(article, tuning);

  return clampCap(length + difficulty + topic);
}

/**
 * Applies the goal-path nudge to a normalised 0–1 base score. The adjustment is
 * additive and capped at ±{@link GOAL_PATH_ADJUSTMENT_CAP}; the result is
 * clamped back into [0, 1]. PURE — no DB, no AI, article metadata + path only.
 *
 * @param baseScore Normalised core score in [0, 1].
 */
export function applyGoalPathAdjustment(
  baseScore: number,
  article: GoalPathArticle,
  goalPath: GoalPath,
): number {
  return clamp01(baseScore + goalPathDelta(article, goalPath));
}

/**
 * True when the path tuning would give this article a net-positive nudge — used
 * by the content-starvation guard to count how many candidates a path "fits".
 */
export function goalPathCandidateFits(
  article: GoalPathArticle,
  goalPath: GoalPath,
): boolean {
  return goalPathDelta(article, goalPath) > 0;
}

/**
 * Content-starvation guard. Returns the effective goal path to score with: the
 * selected path when at least {@link GOAL_PATH_MIN_CANDIDATES} candidates fit
 * it, otherwise `null` (relax to standard scoring so content is never starved).
 * A `null` input passes straight through.
 */
export function resolveEffectiveGoalPath(
  candidates: GoalPathArticle[],
  goalPath: GoalPath | null,
): GoalPath | null {
  if (!goalPath) return null;
  let fitting = 0;
  for (const candidate of candidates) {
    if (goalPathCandidateFits(candidate, goalPath)) {
      fitting += 1;
      if (fitting >= GOAL_PATH_MIN_CANDIDATES) return goalPath;
    }
  }
  return null;
}
