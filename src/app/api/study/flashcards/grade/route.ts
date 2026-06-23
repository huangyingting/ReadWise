import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, oneOf } from "@/lib/validation";
import { gradeFlashcard, getReviewSummary } from "@/lib/flashcards";
import type { Grade } from "@/lib/srs";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics";

const GRADES = ["again", "hard", "good", "easy"] as const;

const bodySchema = object({
  savedWordId: nonEmptyString(200),
  grade: oneOf(GRADES),
});

/**
 * POST /api/study/flashcards/grade
 *
 * Applies an SM-2 review grade to a flashcard and returns its updated schedule
 * plus a refreshed due count.
 *
 * Request body: { savedWordId: string, grade: "again"|"hard"|"good"|"easy" }
 *
 * Response 200:
 *   { dueAt: string (ISO-8601) | null, dueCount: number }
 *
 * Errors:
 *   400 — missing or invalid savedWordId / grade
 *   401 — unauthenticated
 *   404 — savedWordId not found or belongs to another user
 */
export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  const result = await gradeFlashcard(
    session.user.id,
    body.savedWordId,
    body.grade as Grade,
  );
  if (!result) throw new ApiError(404, "Flashcard not found");

  const { dueCount } = await getReviewSummary(session.user.id);
  // Product analytics (RW-051): a study review is the funnel's return signal.
  // Metadata only — only the grade, never the reviewed word.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.studyReview,
    userId: session.user.id,
    properties: { grade: body.grade },
  });
  return NextResponse.json({ dueAt: result.dueAt, dueCount });
});
