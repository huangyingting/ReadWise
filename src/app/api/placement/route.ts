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
import {
  PLACEMENT_SEED_LEVELS,
  type PlacementSeedLevel,
} from "@/lib/learning/placement";
import { submitPlacementAttempt } from "@/lib/learning/placement-attempt";
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
    const result = await submitPlacementAttempt(session.user.id, body);
    if (!result.ok && result.reason === "invalid-counts") {
      throw new ApiError(400, "correctCount cannot exceed totalCount");
    }
    if (!result.ok) {
      throw new ApiError(404, "Article not found in public library");
    }
    return NextResponse.json(result);
  },
);
