import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CAPABILITIES, hasCapability, type Capability } from "@/lib/rbac";

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

/**
 * Route-handler guard requiring a named capability (RW-011). Returns 401 for an
 * unauthenticated request, 403 when the session lacks the capability, otherwise
 * the session. Use this to protect API routes by capability instead of role.
 */
export async function requireCapabilityApi(
  capability: Capability,
): Promise<AuthResult> {
  const result = await requireSessionApi();
  if (result.error) {
    return result;
  }
  if (!hasCapability(result.session.user, capability)) {
    return {
      session: result.session,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return result;
}

export async function requireAdminApi(): Promise<AuthResult> {
  return requireCapabilityApi(CAPABILITIES.adminAccess);
}
