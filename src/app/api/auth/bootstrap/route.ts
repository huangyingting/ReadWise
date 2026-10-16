import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bootstrapAdmin } from "@/lib/auth/bootstrap";
import { accountAdmissionMode } from "@/lib/account-admission/policy";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
import { createDatabaseSession } from "@/lib/account-admission/session";
import { setDatabaseSessionCookie } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";

export async function GET() {
  const admins = await prisma.user.findMany({
    where: { role: "Admin" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    needsBootstrap: admins.length === 0,
    adminCount: admins.length,
    admins: admins.map((a) => ({
      id: a.id,
      email: a.email || "",
      name: a.name || a.email || "Admin",
      role: a.role,
      createdAt: a.createdAt.toISOString(),
    })),
    admissionMode: accountAdmissionMode(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const user = await bootstrapAdmin({
      email: String(body.email || ""),
      password: String(body.password || ""),
      name: body.name ? String(body.name) : null,
    });
    const session = await createDatabaseSession(user.id);
    const response = NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        redirectTo: "/admin/invitations",
      },
      { status: 201 },
    );
    setDatabaseSessionCookie(response, session);
    return response;
  } catch (err: unknown) {
    if (err instanceof AccountAdmissionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bootstrap failed." },
      { status: 500 },
    );
  }
}
