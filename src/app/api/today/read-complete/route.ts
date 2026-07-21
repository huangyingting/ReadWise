import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object } from "@/lib/validation";
import { optionalTimezoneString } from "@/lib/timezone";
import {
  enforceTodayGate,
  markTodayReadingCompleteManual,
} from "@/lib/engagement/today-session/actions";

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
  timezone: optionalTimezoneString,
});

type ManualCompletionView = NonNullable<
  Awaited<ReturnType<typeof markTodayReadingCompleteManual>>
>;

function readCompleteResponse(view: ManualCompletionView | null) {
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
}

export const POST = createHandler(
  { body: readCompleteBody },
  async ({ body, session }) => {
    enforceTodayGate();

    const view = await markTodayReadingCompleteManual({
      userId: session.user.id,
      requestTimezone: body.timezone ?? null,
    });

    return readCompleteResponse(view);
  },
);
