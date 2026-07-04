import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { searchArticles, articleAccessContext } from "@/lib/article-library";
import { parseAdminArticlesQuery, type ArticlesAdminQuery } from "@/lib/admin/articles/schemas";

export const GET = createCapabilityHandler(
  CAPABILITIES.articlesManage,
  { query: parseAdminArticlesQuery }, async ({ query, session }) => {
  const result = await searchArticles(adminArticleSearchInput(query, session.user));
  return NextResponse.json(result);
});

function adminArticleSearchInput(query: ArticlesAdminQuery, user: Session["user"]) {
  return { ...query, context: articleAccessContext(user) };
}
