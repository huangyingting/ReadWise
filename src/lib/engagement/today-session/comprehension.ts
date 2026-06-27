/**
 * Today Session — lightweight comprehension feedback & remediation (#807).
 *
 * @server-only — the orchestration imports Prisma (via the repository, the
 * `TodayComprehensionFeedback` delegate, and the existing mastery paths). The
 * controlled-value constants + validators at the top are pure and unit-tested
 * in isolation.
 *
 * v1.1 replaces the heavyweight "full article quiz / difficulty feedback"
 * comprehension signal with a low-pressure post-reading self-check:
 *
 *   1. A single self-rating (`confident` | `partial` | `confused`).
 *   2. ZERO or ONE lightweight MCQ drawn from the article's existing
 *      `QuizQuestion` rows (most recently added when present; self-rating only
 *      when none exist — graceful degradation).
 *
 * Self-rating ALONE advances `comprehensionCompletedAt` — no forced quiz. A
 * wrong MCQ answer surfaces a low-pressure remediation step (a deep-link back to
 * the article reader; no AI). Structured weakness signals feed the EXISTING
 * mastery paths (`updateArticleMastery` + `recordSkillEvidence`) without
 * requiring a full quiz attempt.
 *
 * Privacy invariant: this module persists/logs IDS, ENUMS, and BOOLEANS ONLY —
 * the self-rating, an optional question id, a boolean MCQ outcome, a controlled
 * skill tag, and the remediation-viewed flag. It NEVER stores or emits article
 * text, question text, answer/option text, definitions, or explanations.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import type { Skill } from "@/lib/learning/types";
import { getTodaySession } from "./repository";
import { resolveLocalDate } from "./local-date";
import { markTodayComprehensionComplete } from "./completion";
import { emitTodayComprehensionSubmitted } from "./analytics";
import type { TodayCompletionTier, TodaySessionStatus } from "./types";

// ---------------------------------------------------------------------------
// Controlled values (pure)
// ---------------------------------------------------------------------------

/** Low-pressure self-rating answers. Controlled — never free text. */
export const COMPREHENSION_SELF_RATINGS = [
  "confident",
  "partial",
  "confused",
] as const;

export type ComprehensionSelfRating =
  (typeof COMPREHENSION_SELF_RATINGS)[number];

export function isComprehensionSelfRating(
  value: unknown,
): value is ComprehensionSelfRating {
  return (
    typeof value === "string" &&
    (COMPREHENSION_SELF_RATINGS as readonly string[]).includes(value)
  );
}

/**
 * Controlled skill tags a comprehension MCQ can carry. Lets weakness signals
 * distinguish the four reading sub-skills "where available" (#807 AC). Stored as
 * a controlled string — never the question text behind the tag.
 */
export const COMPREHENSION_SKILL_TAGS = [
  "main_idea",
  "detail",
  "inference",
  "vocabulary_in_context",
] as const;

export type ComprehensionSkillTag =
  (typeof COMPREHENSION_SKILL_TAGS)[number];

export function isComprehensionSkillTag(
  value: unknown,
): value is ComprehensionSkillTag {
  return (
    typeof value === "string" &&
    (COMPREHENSION_SKILL_TAGS as readonly string[]).includes(value)
  );
}

/**
 * Map a self-rating to a 0–1 skill-evidence outcome. Self-rating is honest but
 * subjective, so it is fed as LOW-WEIGHT evidence (see {@link SELF_RATING_WEIGHT})
 * — it surfaces a weak area without ever penalising a learner for honesty in the
 * way streak / gamification might.
 */
const SELF_RATING_OUTCOME: Record<ComprehensionSelfRating, number> = {
  confident: 0.9,
  partial: 0.6,
  confused: 0.3,
};

/** Self-rating is subjective → low evidence weight. */
const SELF_RATING_WEIGHT = 0.5;

/**
 * Map a controlled skill tag to one of the six tracked `SkillMastery` skills.
 * Reading-comprehension sub-skills roll up into `comprehension`;
 * vocabulary-in-context rolls up into `vocabulary`. Returns `comprehension` as
 * the default when no tag is available so an MCQ outcome is never lost.
 */
export function comprehensionSkillForTag(
  tag: ComprehensionSkillTag | null,
): Skill {
  if (tag === "vocabulary_in_context") return "vocabulary";
  return "comprehension";
}

// ---------------------------------------------------------------------------
// MCQ selection (server-only) — ids/options for DISPLAY, never the answer
// ---------------------------------------------------------------------------

/**
 * A single comprehension MCQ shaped for DISPLAY. Deliberately omits
 * `correctIndex` so the answer is never leaked to the client — grading happens
 * server-side in {@link submitTodayComprehension}.
 */
export type TodayComprehensionQuestion = {
  id: string;
  question: string;
  options: string[];
};

/** Parse a stored `options` JSON column into a clean `string[]`. */
function parseOptions(raw: Prisma.JsonValue | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((o): o is string => typeof o === "string");
  }
  return [];
}

/**
 * Select ONE lightweight comprehension MCQ for an article from its existing
 * cached `QuizQuestion` rows, or `null` when none exist (graceful degradation to
 * self-rating only). Picks the most recently added question — the question
 * selection policy is intentionally simple and tag-agnostic because the current
 * `QuizQuestion` schema carries no per-question skill tag. Returns the id +
 * display text + options ONLY (never `correctIndex`).
 */
export async function selectTodayComprehensionQuestion(
  articleId: string,
): Promise<TodayComprehensionQuestion | null> {
  const row = await prisma.quizQuestion.findFirst({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    select: { id: true, question: true, options: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    options: parseOptions(row.options),
  };
}

// ---------------------------------------------------------------------------
// Comprehension check — GET (selection for the UI)
// ---------------------------------------------------------------------------

/** Privacy-safe payload describing today's comprehension self-check. */
export type TodayComprehensionCheck = {
  /** True when there is an active Today session with a primary article. */
  available: boolean;
  /** The day's primary article id (deep-link anchor), or null. */
  articleId: string | null;
  /** The optional MCQ to present, or null (self-rating only). */
  question: TodayComprehensionQuestion | null;
  /** True once the comprehension step has already completed today. */
  completed: boolean;
  /** True once a feedback row has already been recorded today (idempotent UI). */
  alreadySubmitted: boolean;
};

/**
 * Load the comprehension self-check for an authenticated learner's local day.
 * Resolves the day's primary article, selects an optional MCQ, and reports
 * whether the step is already complete / already submitted so the UI degrades
 * gracefully (self-rating only when no question exists; hidden once done).
 */
export async function loadTodayComprehensionCheck(args: {
  userId: string;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<TodayComprehensionCheck> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session || !session.primaryArticleId) {
    return {
      available: false,
      articleId: null,
      question: null,
      completed: false,
      alreadySubmitted: false,
    };
  }

  const [question, existing] = await Promise.all([
    selectTodayComprehensionQuestion(session.primaryArticleId),
    prisma.todayComprehensionFeedback.findFirst({
      where: { userId: args.userId, todaySessionId: session.id },
      select: { id: true },
    }),
  ]);

  return {
    available: session.status === "active",
    articleId: session.primaryArticleId,
    question,
    completed: session.comprehensionCompletedAt != null,
    alreadySubmitted: existing != null,
  };
}

// ---------------------------------------------------------------------------
// Comprehension check — POST (submit + mastery + remediation)
// ---------------------------------------------------------------------------

export type SubmitTodayComprehensionArgs = {
  userId: string;
  requestTimezone?: string | null;
  now?: Date;
  /** Required controlled self-rating. */
  selfRating: ComprehensionSelfRating;
  /** Optional id of the MCQ that was shown. */
  questionId?: string | null;
  /** Optional chosen option index — graded server-side against `correctIndex`. */
  selectedIndex?: number | null;
  /** Optional controlled skill tag for the MCQ (weakness-signal dimension). */
  skillTag?: ComprehensionSkillTag | null;
  /** True when the learner opened the remediation card (sticky once true). */
  remediationViewed?: boolean;
};

/** Privacy-safe result of a comprehension submission. */
export type TodayComprehensionResult = {
  /** False when there was no active Today session / primary article to attach to. */
  updated: boolean;
  status: TodaySessionStatus | null;
  completionTier: TodayCompletionTier | null;
  completed: boolean;
  /** True/false when an MCQ was graded; null when no MCQ was answered. */
  mcqCorrect: boolean | null;
  /** Low-pressure remediation guidance (shown on a wrong answer). */
  remediation: {
    /** True when remediation should be shown (wrong MCQ answer). */
    show: boolean;
    /** Deep-link back to the article reader, or null. Never embeds content. */
    articleHref: string | null;
  };
};

/**
 * Upsert (idempotently) the single `TodayComprehensionFeedback` row for a Today
 * session. Persists IDS / ENUMS / BOOLEANS ONLY. `remediationViewed` is sticky:
 * once true it never flips back to false on a re-submit.
 */
async function upsertComprehensionFeedback(args: {
  userId: string;
  todaySessionId: string;
  articleId: string;
  selfRating: ComprehensionSelfRating;
  questionId: string | null;
  mcqCorrect: boolean | null;
  skillTag: ComprehensionSkillTag | null;
  remediationViewed: boolean;
}): Promise<void> {
  const existing = await prisma.todayComprehensionFeedback.findFirst({
    where: { userId: args.userId, todaySessionId: args.todaySessionId },
    select: { id: true, remediationViewed: true },
  });

  const data = {
    selfRating: args.selfRating,
    questionId: args.questionId,
    mcqCorrect: args.mcqCorrect,
    skillTag: args.skillTag,
    remediationViewed:
      args.remediationViewed || (existing?.remediationViewed ?? false),
  };

  if (existing) {
    await prisma.todayComprehensionFeedback.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.todayComprehensionFeedback.create({
    data: {
      userId: args.userId,
      todaySessionId: args.todaySessionId,
      articleId: args.articleId,
      ...data,
    },
  });
}

/**
 * Submit a learner's comprehension self-check for their local day.
 *
 *   - Advances the Today comprehension step from the self-rating ALONE
 *     (idempotent via {@link markTodayComprehensionComplete}).
 *   - Grades the optional MCQ SERVER-SIDE against the cached
 *     `QuizQuestion.correctIndex` (the client never receives the answer); a
 *     question that is missing or not part of today's primary article is
 *     ignored (`mcqCorrect = null`).
 *   - Persists the controlled feedback row (ids/enums/booleans only).
 *   - Feeds weakness signals into the EXISTING mastery paths
 *     (`updateArticleMastery` + `recordSkillEvidence`) best-effort — a mastery
 *     failure NEVER breaks comprehension completion.
 *   - Returns a wrong-answer remediation deep-link (no AI, no embedded content).
 *
 * Returns `null` (caller maps to a no-op response) when there is no active Today
 * session or primary article to attach the check to.
 */
export async function submitTodayComprehension(
  args: SubmitTodayComprehensionArgs,
): Promise<TodayComprehensionResult | null> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session || !session.primaryArticleId) return null;
  const articleId = session.primaryArticleId;

  // ── Grade the optional MCQ server-side (never trust a client outcome) ──────
  const skillTag = isComprehensionSkillTag(args.skillTag) ? args.skillTag : null;
  let mcqCorrect: boolean | null = null;
  let effectiveQuestionId: string | null = null;
  if (
    args.questionId &&
    typeof args.selectedIndex === "number" &&
    Number.isInteger(args.selectedIndex)
  ) {
    const question = await prisma.quizQuestion.findFirst({
      where: { id: args.questionId, articleId },
      select: { correctIndex: true },
    });
    if (question) {
      effectiveQuestionId = args.questionId;
      mcqCorrect = args.selectedIndex === question.correctIndex;
    }
  }

  const remediationShow = mcqCorrect === false;

  // ── Advance the comprehension step from the self-rating alone ──────────────
  const view = await markTodayComprehensionComplete({
    userId: args.userId,
    articleId,
    now,
    requestTimezone: args.requestTimezone,
    selfRating: args.selfRating,
  });

  // ── Persist the controlled feedback row (ids/enums/booleans only) ──────────
  await bestEffortMastery("today.comprehension_feedback", () =>
    upsertComprehensionFeedback({
      userId: args.userId,
      todaySessionId: session.id,
      articleId,
      selfRating: args.selfRating,
      questionId: effectiveQuestionId,
      mcqCorrect,
      skillTag,
      remediationViewed: args.remediationViewed === true || remediationShow,
    }),
  );

  // ── Feed weakness signals into the EXISTING mastery paths (best-effort) ────
  await Promise.all([
    bestEffortMastery("today.comprehension_article_mastery", () =>
      updateArticleMastery(args.userId, articleId),
    ),
    bestEffortMastery("today.comprehension_self_rating_skill", () =>
      recordSkillEvidence(
        args.userId,
        "comprehension",
        SELF_RATING_OUTCOME[args.selfRating],
        SELF_RATING_WEIGHT,
      ),
    ),
    mcqCorrect != null
      ? bestEffortMastery("today.comprehension_mcq_skill", () =>
          recordSkillEvidence(
            args.userId,
            comprehensionSkillForTag(skillTag),
            mcqCorrect ? 1 : 0,
          ),
        )
      : Promise.resolve(null),
  ]);

  // ── Product analytics (metadata only — enums/booleans, never content) ──────
  if (view) {
    await emitTodayComprehensionSubmitted(view, {
      selfRating: args.selfRating,
      skillTag,
      mcqCorrect,
      remediationViewed: args.remediationViewed === true || remediationShow,
    });
  }

  return {
    updated: view != null,
    status: view?.status ?? null,
    completionTier: view?.completionTier ?? null,
    completed: view?.completedAt != null,
    mcqCorrect,
    remediation: {
      show: remediationShow,
      articleHref: remediationShow ? `/reader/${articleId}` : null,
    },
  };
}
