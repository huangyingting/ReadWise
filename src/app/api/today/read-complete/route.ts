import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, optional, string } from "@/lib/validation";
import { markTodayReadingCompleteManual } from "@/lib/engagement/today-session/completion";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";

/**
 * POST /api/today/read-complete
 *
 * Manual, Today-only fallback that marks the learner's current primary article
 * read for the day. It updates Today step state ONLY — it never reads or mutates
 * `ReadingProgress`, so it cannot fabricate reading-progress facts. The optional
 * `timezone` lets the client anchor the correct local day; otherwise the saved
 * profile timezone (then UTC) is used.
 *
 * Body: { timezone?: string }
 * Response 200: { status, completionTier, completed } — anchors/flags only.
 * 404s when the feature is disabled, mirroring the other Today routes.
 */
const readCompleteBody = object({
  timezone: optional(string({ max: 100 })),
});

export const POST = createHandler(
  { body: readCompleteBody },
  async ({ body, session }) => {
    if (!isTodaySessionFeatureEnabled()) {
      throw new ApiError(404, "Not found");
    }

    const view = await markTodayReadingCompleteManual({
      userId: session.user.id,
      requestTimezone: body.timezone ?? null,
    });

    if (!view) {
      // No active Today session, or a no-candidate day with no primary article.
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
