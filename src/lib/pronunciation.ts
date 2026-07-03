/**
 * Pronunciation practice persistence (M16).
 *
 * The pronunciation assessment itself runs client-side in the browser via the
 * Azure Speech SDK using a server-issued short-lived token. This module persists
 * the resulting scores and provides per-user history queries.
 *
 * Score validation is provided by the shared practice-attempts helpers (REF-051).
 */
import { prisma } from "@/lib/prisma";
import { validateBoundedScore } from "@/lib/learning/practice-attempts";

const MAX_REFERENCE_TEXT = 2000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

const PRONUNCIATION_ATTEMPT_SELECT = {
  id: true,
  referenceText: true,
  accuracyScore: true,
  fluencyScore: true,
  completenessScore: true,
  pronScore: true,
  articleId: true,
  createdAt: true,
} as const;

export type AttemptInput = {
  referenceText: string;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  articleId?: string;
};

export type AttemptRecord = {
  id: string;
  referenceText: string;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  articleId: string | null;
  createdAt: Date;
};

export type PronunciationHistorySummary = {
  attempts: AttemptRecord[];
  attemptCount: number;
  bestPronScore: number | null;
  averageScore: number | null;
};

/**
 * Persists a pronunciation attempt and returns it along with the user's
 * all-time best pronScore. Validates all four score fields (0–100 integers)
 * and referenceText (non-empty, max 2000 chars).
 */
export async function recordPronunciationAttempt(
  userId: string,
  input: AttemptInput,
): Promise<{ attempt: AttemptRecord; best: number | null }> {
  const {
    referenceText,
    accuracyScore,
    fluencyScore,
    completenessScore,
    pronScore,
    articleId,
  } = input;

  const normalizedReferenceText = normalizeReferenceText(referenceText);
  validateAttemptScores(input);

  const attempt = await prisma.pronunciationAttempt.create({
    data: {
      userId,
      articleId: articleId ?? null,
      referenceText: normalizedReferenceText,
      accuracyScore,
      fluencyScore,
      completenessScore,
      pronScore,
    },
    select: PRONUNCIATION_ATTEMPT_SELECT,
  });

  const agg = await prisma.pronunciationAttempt.aggregate({
    where: { userId },
    _max: { pronScore: true },
  });

  return { attempt, best: agg._max.pronScore ?? null };
}

function normalizeReferenceText(referenceText: string): string {
  if (!referenceText || referenceText.trim().length === 0) {
    throw new Error("referenceText is required");
  }
  if (referenceText.length > MAX_REFERENCE_TEXT) {
    throw new Error(
      `referenceText must be at most ${MAX_REFERENCE_TEXT} characters`,
    );
  }

  return referenceText.trim();
}

function validateAttemptScores(input: AttemptInput): void {
  validateBoundedScore(input.accuracyScore, "accuracyScore");
  validateBoundedScore(input.fluencyScore, "fluencyScore");
  validateBoundedScore(input.completenessScore, "completenessScore");
  validateBoundedScore(input.pronScore, "pronScore");
}

/**
 * Returns the user's pronunciation attempt history, newest-first, with
 * aggregate stats (attemptCount, bestPronScore, averageScore).
 */
export async function getPronunciationHistory(
  userId: string,
  opts: { limit?: number } = {},
): Promise<PronunciationHistorySummary> {
  const limit = normalizeHistoryLimit(opts.limit);

  const [attempts, agg] = await Promise.all([
    prisma.pronunciationAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: PRONUNCIATION_ATTEMPT_SELECT,
    }),
    prisma.pronunciationAttempt.aggregate({
      where: { userId },
      _count: { id: true },
      _avg: { pronScore: true },
      _max: { pronScore: true },
    }),
  ]);

  return {
    attempts,
    attemptCount: agg._count.id,
    bestPronScore: agg._max.pronScore ?? null,
    averageScore:
      agg._avg.pronScore !== null ? Math.round(agg._avg.pronScore) : null,
  };
}

function normalizeHistoryLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT));
}
