import { NextResponse } from "next/server";
import { ApiError, createHandler } from "@/lib/api-handler";
import { queryString } from "@/lib/validation";
import { searchTextSetArticleOptions } from "@/lib/classroom/text-sets";

function parseQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: { organizationId: queryString(params, "organizationId"), q: queryString(params, "q").slice(0, 100) },
  };
}

/** Articles a teacher may add to a text set in the organization (title/author/source search). */
export const GET = createHandler({ query: parseQuery }, async ({ query, session }) => {
  if (!query.organizationId) throw new ApiError(400, "organizationId is required");
  const articles = await searchTextSetArticleOptions(session.user, query.organizationId, query.q);
  if (!articles) throw new ApiError(403, "Forbidden");
  return NextResponse.json({ articles });
});
