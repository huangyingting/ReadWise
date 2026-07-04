import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import {
  getScopedClassroomAnalytics,
  parseClassroomAnalyticsFilters,
} from "@/lib/analytics/classroom-access";

function parseAnalyticsQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: parseClassroomAnalyticsFilters(params),
  };
}

/**
 * Returns a classroom's analytics scoped to the caller's role (RW-061/063):
 *   - the classroom's teacher / a system admin → per-student detail;
 *   - an org admin → aggregate-only (individual rows redacted);
 *   - anyone else → 403 (learners read their own data via `/assignments`).
 */
export const GET = createHandler(
  { params: idParams, query: parseAnalyticsQuery },
  async ({ params, query, session }) => {
    const { role, analytics } = await getScopedClassroomAnalytics({
      classroomId: params.id,
      viewer: session.user,
      filters: query,
    });

    return NextResponse.json({ role, analytics });
  },
);
