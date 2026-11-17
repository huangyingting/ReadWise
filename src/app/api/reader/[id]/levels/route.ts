import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { levelKeysForArticles } from "@/lib/article-levels/variants";

/**
 * Reading levels an article can be read at (#1303), easiest first then
 * "original"; empty for single-level articles. Used by the assignment form.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const { article } = await requireReadableArticle(params.id, session.user);
  const levels = await levelKeysForArticles([article.id]);
  return NextResponse.json({ levels: levels.get(article.id) ?? [] });
});
