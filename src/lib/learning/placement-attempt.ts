/**
 * Placement attempt submission workflow.
 *
 * The interface accepts controlled levels and counts only. It owns the
 * cross-field invariant, public-passage eligibility, conservative scoring,
 * single-row persistence, and privacy-safe analytics ordering.
 */

import type { EnglishLevel } from "@/lib/leveling/cefr-primitives";
import { ENGLISH_LEVELS, levelRank } from "@/lib/leveling/cefr-primitives";
import { getPublicListableArticleById } from "@/lib/article-library";
import { ANALYTICS_EVENT_TYPES, recordEvent } from "@/lib/analytics/events";
import { prisma } from "@/lib/prisma";
import type { PlacementSeedLevel } from "./placement";
import { validateCountScore } from "./practice-attempts";

export type PlacementAttemptKind = "initial" | "retake";

export type SubmitPlacementAttemptInput = {
  articleId: string;
  seedLevel: PlacementSeedLevel;
  correctCount: number;
  totalCount: number;
  lookupCount: number;
  skipped?: boolean;
  attempt?: PlacementAttemptKind;
};

export type PlacementSubmissionResult =
  | {
      ok: true;
      recommendedLevel: EnglishLevel;
      skipped: boolean;
    }
  | {
      ok: false;
      reason: "invalid-counts" | "article-not-public";
    };

const HIGH_CORRECT_RATIO = 0.8;
const LOW_CORRECT_RATIO = 0.6;
const LOW_LOOKUP_RATE = 0.05;
const HIGH_LOOKUP_RATE = 0.1;

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function placementOffset(correctRatio: number, lookupRate: number): -1 | 0 | 1 {
  if (correctRatio < LOW_CORRECT_RATIO || lookupRate >= HIGH_LOOKUP_RATE) {
    return -1;
  }
  if (correctRatio >= HIGH_CORRECT_RATIO && lookupRate < LOW_LOOKUP_RATE) {
    return 1;
  }
  return 0;
}

function recommendedLevelFor(
  input: SubmitPlacementAttemptInput,
  wordCount: number,
): EnglishLevel {
  if (input.skipped === true) return input.seedLevel;
  const correctRatio = safeRatio(input.correctCount, input.totalCount);
  const lookupRate = safeRatio(input.lookupCount, wordCount);
  return ENGLISH_LEVELS[
    levelRank(input.seedLevel) + placementOffset(correctRatio, lookupRate)
  ];
}

function hasValidPlacementCounts(input: SubmitPlacementAttemptInput): boolean {
  try {
    if (input.skipped === true && input.totalCount === 0 && input.correctCount === 0) {
      return true;
    }
    validateCountScore(input.correctCount, input.totalCount);
    return true;
  } catch {
    return false;
  }
}

/** Submits one initial or retake Placement attempt for a learner. */
export async function submitPlacementAttempt(
  userId: string,
  input: SubmitPlacementAttemptInput,
): Promise<PlacementSubmissionResult> {
  if (!hasValidPlacementCounts(input)) {
    return { ok: false, reason: "invalid-counts" };
  }

  const article = await getPublicListableArticleById(input.articleId, {
    select: { id: true, wordCount: true },
  });
  if (!article) {
    return { ok: false, reason: "article-not-public" };
  }

  const skipped = input.skipped ?? false;
  const attempt = input.attempt ?? "initial";
  const recommendedLevel = recommendedLevelFor(
    { ...input, skipped },
    article.wordCount ?? 0,
  );
  const persisted = {
    passageArticleId: input.articleId,
    seedLevel: input.seedLevel,
    recommendedLevel,
    questionCount: input.totalCount,
    correctCount: input.correctCount,
    lookupCount: input.lookupCount,
    skipped,
    attempt,
    completedAt: skipped ? null : new Date(),
  };

  await prisma.placementResult.upsert({
    where: { userId },
    create: { userId, ...persisted },
    update: persisted,
  });

  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.placementCompleted,
    userId,
    properties: {
      seedLevel: input.seedLevel,
      recommendedLevel,
      skipped,
      questionCount: input.totalCount,
      correctCount: input.correctCount,
      attempt,
    },
  });

  return { ok: true, recommendedLevel, skipped };
}