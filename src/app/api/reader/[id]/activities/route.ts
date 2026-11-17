import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, queryString } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { isEducator } from "@/lib/classroom/educator";
import { getReaderActivities } from "@/lib/classroom/activities";

function parseQuery(params: URLSearchParams) {
  return { ok: true as const, value: { preview: queryString(params, "preview") === "1" } };
}

/**
 * Polls and Checks for Understanding for the reader (#1304). `?preview=1`
 * lets educators preview their assignment's activities as a student
 * (responses aren't saved); it is ignored for everyone else.
 */
export const GET = createHandler({ params: idParams, query: parseQuery }, async ({ params, query, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const preview = query.preview && (await isEducator(session.user));
  return NextResponse.json(await getReaderActivities(session.user, article.id, { preview }));
});
