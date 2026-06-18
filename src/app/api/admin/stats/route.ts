import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/api-auth";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const [users, admins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "Admin" } }),
  ]);

  return NextResponse.json({ users, admins });
}
