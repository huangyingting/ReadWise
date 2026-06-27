import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { convertHighlightToReviewCard } from "@/lib/learning/review-assets";

/**
 * POST /api/highlights/[id]/review-card
 *
 * Optional, low-pressure conversion (#812): turn one of the learner's own
 * highlights/notes into a spaced-repetition review card, REUSING the existing
 * flashcard/SRS (`SavedWord`) store. Idempotent — converting the same passage
 * again returns the existing card without resetting its schedule.
 *
 * Response 200: { cardId, dueAt: string | null, created }
 * Errors: 401 unauthenticated; 404 highlight not found / not owned by caller.
 */
export const POST = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await convertHighlightToReviewCard(session.user.id, params.id);
    if (!result) throw new ApiError(404, "Highlight not found");
    return NextResponse.json({
      cardId: result.cardId,
      dueAt: result.dueAt ? result.dueAt.toISOString() : null,
      created: result.created,
    });
  },
);
