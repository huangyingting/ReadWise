import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
import { getPronunciationHistory } from "@/lib/pronunciation";

/**
 * GET /api/pronunciation/history?limit=N
 *
 * Returns the authenticated user's pronunciation attempt history (newest-first)
 * with aggregate stats. Results are ownership-scoped to session.user.id.
 */
export const GET = createHandler(
  {
    query: (params) => ({
      ok: true,
      value: {
        limit: queryInt(params, "limit", { fallback: 20, min: 1, max: 100 }),
      },
    }),
  },
  async ({ session, query }) => {
    const history = await getPronunciationHistory(session.user.id, {
      limit: query.limit,
    });
    return NextResponse.json(history);
  },
);
