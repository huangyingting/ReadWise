import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getReaderAnnotationContext } from "@/lib/classroom/annotations";

/**
 * Classroom annotations for the reader (#1307): the viewer's teaching and
 * learning assignments of the article, their guided prompts, and the
 * viewer's own replies and evidence. Items carry the reading level their
 * anchor indexes (#1303); the reader paints only the current level inline.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  return NextResponse.json(await getReaderAnnotationContext(session.user, article.id));
});
