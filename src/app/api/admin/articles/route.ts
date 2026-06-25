import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { searchArticles, articleAccessContext } from "@/lib/article-library";
import { parseAdminArticlesQuery } from "@/lib/admin/articles/schemas";

export const GET = createAdminHandler({ query: parseAdminArticlesQuery }, async ({ query, session }) => {
  const result = await searchArticles({ ...query, context: articleAccessContext(session.user) });
  return NextResponse.json(result);
});
