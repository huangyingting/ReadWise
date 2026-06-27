/**
 * API route auth guards.
 *
 * @server-only — Must never be imported from a "use client" file.
 * For API route handlers only. See ADR-0010.
 */
import type { Capability } from "@/lib/rbac";
import { loadSession, sessionHasCapability, type AuthResult } from "@/lib/auth-core";
import { NextResponse } from "next/server";

export type { AuthResult };

export async function requireSessionApi(): Promise<AuthResult> {
  const session = await loadSession();
  if (!session) {
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
  if (!sessionHasCapability(result.session, capability)) {
    return {
      session: result.session,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return result;
}

