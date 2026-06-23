import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

type AuthResult =
  | { session: Session; error?: undefined }
  | { session?: Session; error: NextResponse };

export async function requireSessionApi(): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

export async function requireAdminApi(): Promise<AuthResult> {
  const result = await requireSessionApi();
  if (result.error) {
    return result;
  }
  if (result.session.user.role !== "Admin") {
    return {
      session: result.session,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return result;
}
