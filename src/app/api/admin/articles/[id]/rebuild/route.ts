import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { rebuildArticleAi } from "@/lib/admin-articles";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await params;
  const result = await rebuildArticleAi(id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}
