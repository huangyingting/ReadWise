import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { enrollInSeries, unenrollFromSeries } from "@/lib/engagement/series";

/**
 * POST /api/series/[id]/enroll
 *
 * Enroll the authenticated learner in a public, active curated reading series
 * (#813). Idempotent — re-enrolling reactivates an existing enrollment and
 * preserves its position. A missing or non-public series returns 404 (IDOR-safe;
 * existence is never leaked beyond the public set). Unauthenticated requests are
 * rejected with 401 by the handler wrapper. Always scoped to the authenticated
 * user — the path id selects the series, never another user's enrollment.
 */
export const POST = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await enrollInSeries(session.user.id, params.id);
    if (!result.ok) throw new ApiError(404, "Not found");
    return NextResponse.json({ ok: true, status: result.status });
  },
);

/**
 * DELETE /api/series/[id]/enroll
 *
 * Unenroll the authenticated learner from a public series by removing their
 * enrollment row. Idempotent — unenrolling when not enrolled is a no-op success.
 * A missing or non-public series returns 404. Auth required (401 otherwise).
 */
export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await unenrollFromSeries(session.user.id, params.id);
    if (!result.ok) throw new ApiError(404, "Not found");
    return NextResponse.json({ ok: true });
  },
);
