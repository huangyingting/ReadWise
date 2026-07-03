import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
import { getPronunciationHistory } from "@/lib/pronunciation";

const historyLimitOptions = { fallback: 20, min: 1, max: 100 } as const;

function parseHistoryQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      limit: queryInt(params, "limit", historyLimitOptions),
    },
  };
}

/**
 * GET /api/pronunciation/history?limit=N
 *
 * Returns the authenticated user's pronunciation attempt history (newest-first)
 * with aggregate stats. Results are ownership-scoped to session.user.id.
 */
export const GET = createHandler(
  {
    query: parseHistoryQuery,
  },
  async ({ session, query }) => {
    const history = await getPronunciationHistory(session.user.id, {
      limit: query.limit,
    });
    return NextResponse.json(history);
  },
);
