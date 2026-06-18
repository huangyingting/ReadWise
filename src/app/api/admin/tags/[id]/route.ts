import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { deleteTag } from "@/lib/admin-tags";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await params;
  const result = await deleteTag(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
