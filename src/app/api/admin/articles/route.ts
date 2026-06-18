import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { searchArticles } from "@/lib/admin-articles";

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") ?? "";
  const status = searchParams.get("status");
  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const result = await searchArticles({ query, status, page });
  return NextResponse.json(result);
}
