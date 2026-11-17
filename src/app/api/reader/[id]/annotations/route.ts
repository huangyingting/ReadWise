import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getReaderAnnotationContext } from "@/lib/classroom/annotations";
import { levelQuery, requireArticleLevel } from "@/lib/article-levels/http";

/**
 * Classroom annotations for the reader (#1307): the viewer's teaching and
 * learning assignments of the article, their guided prompts, and the
 * viewer's own replies and evidence, at the `?level=` reading level (#1303).
 */
export const GET = createHandler({ params: idParams, query: levelQuery }, async ({ params, query, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  await requireArticleLevel(article.id, query.level);
  return NextResponse.json(await getReaderAnnotationContext(session.user, article.id, query.level));
});
