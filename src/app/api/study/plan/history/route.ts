import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
import { getStudyPlanHistory } from "@/lib/learning/study-plan";

const historyLimitOptions = { fallback: 8, min: 1, max: 52 } as const;

function parseHistoryQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      limit: queryInt(params, "limit", historyLimitOptions),
    },
  };
}

/**
 * GET /api/study/plan/history?limit=N
 *
 * Returns the authenticated learner's weekly study-plan snapshots, newest first.
 * Snapshot rows contain derived goals and aggregate evidence only.
 */
export const GET = createHandler(
  { query: parseHistoryQuery },
  async ({ session, query }) => {
    const history = await getStudyPlanHistory(session.user.id, {
      limit: query.limit,
    });
    return NextResponse.json({ history });
  },
);
