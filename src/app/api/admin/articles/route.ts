import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import { searchArticles } from "@/lib/admin-articles";

type ArticlesAdminQuery = {
  query: string;
  status: string | null;
  page: number;
};

function parseQuery(params: URLSearchParams) {
  const value: ArticlesAdminQuery = {
    query: queryString(params, "q"),
    status: params.get("status"),
    page: queryInt(params, "page", { fallback: 1, min: 1 }),
  };
  return { ok: true as const, value };
}

export const GET = createAdminHandler({ query: parseQuery }, async ({ query }) => {
  const result = await searchArticles(query);
  return NextResponse.json(result);
});
