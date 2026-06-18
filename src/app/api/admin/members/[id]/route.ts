import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { updateMemberRole, deleteMember } from "@/lib/admin-members";
import type { Role } from "@prisma/client";

function isRole(value: unknown): value is Role {
  return value === "Admin" || value === "Reader";
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const role = (body as { role?: unknown })?.role;
  if (!isRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (id === auth.session.user.id && role !== "Admin") {
    return NextResponse.json(
      { error: "You cannot remove your own admin role" },
      { status: 409 },
    );
  }

  const result = await updateMemberRole(id, role);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, role: result.role });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await params;
  if (id === auth.session.user.id) {
    return NextResponse.json(
      { error: "You cannot remove your own account" },
      { status: 409 },
    );
  }

  const result = await deleteMember(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
