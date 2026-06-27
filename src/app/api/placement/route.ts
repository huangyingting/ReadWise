import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  object,
  oneOf,
  number,
  boolean,
  optional,
  nonEmptyString,
  type Schema,
  type ValidationResult,
} from "@/lib/validation";
import { getPublicListableArticleById } from "@/lib/article-library";
import { prisma } from "@/lib/prisma";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import {
  computePlacementScore,
  PLACEMENT_SEED_LEVELS,
  type PlacementSeedLevel,
} from "@/lib/learning/placement";
import { loadPlacementPassage } from "@/lib/learning/placement-passage";

/**
 * `/api/placement` — lightweight cold-start reading placement (#806).
 *
 * GET  → returns a curated public-library passage + its self-scoring quiz
 *        questions for a seed level (text is rendered client-side only, never
 *        persisted). Responds `{ available: false }` when no eligible passage
 *        exists so the UI can gracefully skip placement.
 *
 * POST → records the STRUCTURED outcome of a placement attempt. Receives only
 *        counts + controlled levels (never passage/question/answer/word text),
 *        runs the deterministic scorer, and UPSERTs the single per-user
 *        `PlacementResult` row (idempotent on retake).
 *
 * Errors: 401 unauthenticated · 400 invalid body · 404 articleId not in the
 * public library.
 */

const MAX_QUESTION_COUNT = 50;
const MAX_LOOKUP_COUNT = 100_000;

const PLACEMENT_ATTEMPTS = ["initial", "retake"] as const;
type PlacementAttempt = (typeof PLACEMENT_ATTEMPTS)[number];

type PlacementBody = {
  articleId: string;
  correctCount: number;
  totalCount: number;
  lookupCount: number;
  seedLevel: PlacementSeedLevel;
  skipped: boolean | undefined;
  attempt: PlacementAttempt | undefined;
};

const placementSchema = object({
  articleId: nonEmptyString(200),
  correctCount: number({ int: true, min: 0, max: MAX_QUESTION_COUNT }),
  totalCount: number({ int: true, min: 0, max: MAX_QUESTION_COUNT }),
  lookupCount: number({ int: true, min: 0, max: MAX_LOOKUP_COUNT }),
  seedLevel: oneOf(PLACEMENT_SEED_LEVELS),
  skipped: optional(boolean()),
  attempt: optional(oneOf(PLACEMENT_ATTEMPTS)),
}) as Schema<PlacementBody>;

/** GET query: a required, controlled seed level. */
function placementQuery(
  params: URLSearchParams,
): ValidationResult<{ seedLevel: PlacementSeedLevel }> {
  const raw = params.get("seedLevel");
  const res = oneOf(PLACEMENT_SEED_LEVELS)(raw, "seedLevel");
  if (!res.ok) return res;
  return { ok: true, value: { seedLevel: res.value } };
}

export const GET = createHandler(
  { query: placementQuery },
  async ({ query }) => {
    const passage = await loadPlacementPassage(query.seedLevel);
    if (!passage) {
      return NextResponse.json({ available: false });
    }
    return NextResponse.json({ available: true, passage });
  },
);

export const POST = createHandler(
  { body: placementSchema },
  async ({ session, body }) => {
    const userId = session.user.id;

    if (body.correctCount > body.totalCount) {
      throw new ApiError(400, "correctCount cannot exceed totalCount");
    }

    // 404 when the passage is not a public-library article (reuses the shared
    // access helper — never hand-rolled visibility checks).
    const article = await getPublicListableArticleById(body.articleId, {
      select: { id: true, wordCount: true },
    });
    if (!article) {
      throw new ApiError(404, "Article not found in public library");
    }

    const skipped = body.skipped ?? false;
    const attempt: PlacementAttempt = body.attempt ?? "initial";

    // Skipped placements still seed Today: recommendedLevel coerces to the
    // self-reported seed level rather than running the scorer.
    const recommendedLevel = skipped
      ? body.seedLevel
      : computePlacementScore(
          body.seedLevel,
          body.correctCount,
          body.totalCount,
          body.lookupCount,
          article.wordCount ?? 0,
        );

    const completedAt = skipped ? null : new Date();

    // Single per-user row — upsert keeps retake idempotent (no duplicates).
    const persisted = {
      passageArticleId: body.articleId,
      seedLevel: body.seedLevel,
      recommendedLevel,
      questionCount: body.totalCount,
      correctCount: body.correctCount,
      lookupCount: body.lookupCount,
      skipped,
      attempt,
      completedAt,
    };
    await prisma.placementResult.upsert({
      where: { userId },
      create: { userId, ...persisted },
      update: persisted,
    });

    // Product analytics (#806): metadata only — controlled levels + counts.
    // Deliberately NO article id and NO free text (privacy plan §1).
    await recordEvent({
      type: ANALYTICS_EVENT_TYPES.placementCompleted,
      userId,
      properties: {
        seedLevel: body.seedLevel,
        recommendedLevel,
        skipped,
        questionCount: body.totalCount,
        correctCount: body.correctCount,
        attempt,
      },
    });

    return NextResponse.json({ ok: true, recommendedLevel, skipped });
  },
);
