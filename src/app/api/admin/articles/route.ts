import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import type { ValidationResult } from "@/lib/validation";
import { searchArticles } from "@/lib/admin-articles";
import { ARTICLE_STATUSES, articleAccessContext } from "@/lib/article-access";
type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

type ArticlesAdminQuery = {
  query: string;
  status: ArticleStatus | null;
  page: number;
};

const MAX_Q_LENGTH = 200;
const MAX_PAGE = 10_000;

function parseQuery(params: URLSearchParams): ValidationResult<ArticlesAdminQuery> {
  const q = queryString(params, "q");
  if (q.length > MAX_Q_LENGTH) {
    return { ok: false, error: `q must be at most ${MAX_Q_LENGTH} characters` };
  }

  const rawStatus = params.get("status") ?? "";
  let status: ArticleStatus | null = null;
  if (rawStatus !== "") {
    const normalizedStatus = rawStatus.toUpperCase();
    if (!(ARTICLE_STATUSES as readonly string[]).includes(normalizedStatus)) {
      return {
        ok: false,
        error: `status must be one of: ${ARTICLE_STATUSES.join(", ")}`,
      };
    }
    status = normalizedStatus as ArticleStatus;
  }

  const page = queryInt(params, "page", { fallback: 1, min: 1, max: MAX_PAGE });

  return { ok: true, value: { query: q, status, page } };
}

export const GET = createAdminHandler({ query: parseQuery }, async ({ query, session }) => {
  const result = await searchArticles({ ...query, context: articleAccessContext(session.user) });
  return NextResponse.json(result);
});
