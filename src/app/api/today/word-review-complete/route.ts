import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, optional, string } from "@/lib/validation";
import { markTodayWordReviewComplete } from "@/lib/engagement/today-session/completion";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/**
 * POST /api/today/word-review-complete (#811)
 *
 * Thin, idempotent endpoint that marks the learner's Today word-review step
 * complete for their current local day. It does NOT contain completion logic —
 * it simply exposes the existing `markTodayWordReviewComplete` (the same hook
 * wired into flashcard grading) so the OFFLINE mutation queue has a real
 * endpoint to replay `today.word-review-complete` into.
 *
 * Completion is monotonic: `wordReviewCompletedAt` is never overwritten, so a
 * duplicate replay (e.g. from two devices) is a graceful no-op. The action is
 * always scoped to the authenticated user — a userId is never read from the
 * body. The optional `timezone` anchors the correct local day; otherwise the
 * saved profile timezone (then UTC) is used. `localDate` is accepted (and
 * ignored server-side) so the offline payload shape is uniform across Today
 * mutations; the server resolves the canonical local date itself.
 *
 * Body: { timezone?: string, localDate?: string }
 * Response 200: { updated, status, completionTier, completed } — anchors/flags only.
 * 404s when the feature is disabled, mirroring the other Today routes. The
 * response carries IDS / ENUMS / BOOLEANS ONLY — never any learning content.
 */
const wordReviewCompleteBody = object({
  timezone: optional(string({ max: 100 })),
  localDate: optional(string({ max: 10 })),
});

export const POST = createHandler(
  { body: wordReviewCompleteBody },
  async ({ body, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }

    const view = await markTodayWordReviewComplete({
      userId: session.user.id,
      requestTimezone: body.timezone ?? null,
    });

    if (!view) {
      // No active Today session for the resolved local date — graceful no-op.
      return NextResponse.json({ updated: false });
    }

    return NextResponse.json({
      updated: true,
      status: view.status,
      completionTier: view.completionTier,
      completed: view.completedAt != null,
    });
  },
);
