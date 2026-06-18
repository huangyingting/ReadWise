import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { deleteArticle } from "@/lib/admin-articles";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await params;
  const ok = await deleteArticle(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
