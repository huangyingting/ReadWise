import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, oneOf, optional, string } from "@/lib/validation";
import { skipTodaySession, TODAY_SKIP_REASONS } from "@/lib/engagement/today-session";
import {
  defineFeatureGate,
  enforceFeatureGate,
} from "@/lib/runtime-config/feature-flags";

const TODAY_ROUTE_FEATURE_GATE = defineFeatureGate<null, never>({
  feature: "todaySession",
  whenDisabled: (): never => {
    throw new ApiError(404, "Not found");
  },
});

/**
 * POST /api/today/skip
 *
 * Skips the authenticated learner's Today session for their local day with a
 * controlled `skipReason`. An invalid reason is rejected with 400 before any
 * write; the skip is always scoped to the authenticated user (the body can
 * never choose another user's session). Skipping is idempotent and capped by a
 * daily skip limit — a second skip reports `limitReached` with a graceful
 * browse fallback rather than erroring.
 *
 * Body: { skipReason: TodaySkipReason, timezone?: string }
 * Response 200: { skipped, limitReached, browseFallback, status, completionTier,
 *                 promotedBackupIds } — anchors/ids/flags only.
 */
const skipBody = object({
  skipReason: oneOf(TODAY_SKIP_REASONS),
  timezone: optional(string({ max: 100 })),
});

type SkipTodayResult = Awaited<ReturnType<typeof skipTodaySession>>;

function skipResponse(result: SkipTodayResult) {
  return {
    skipped: result.skipped,
    limitReached: result.limitReached,
    browseFallback: result.browseFallback,
    status: result.session.status,
    completionTier: result.session.completionTier,
    promotedBackupIds: result.promotedBackupIds,
  };
}

export const POST = createHandler(
  { body: skipBody },
  async ({ body, session }) => {
    enforceFeatureGate(TODAY_ROUTE_FEATURE_GATE, null);

    const result = await skipTodaySession({
      userId: session.user.id,
      skipReason: body.skipReason,
      requestTimezone: body.timezone ?? null,
    });

    return NextResponse.json(skipResponse(result));
  },
);
