/**
 * Shared auth core (REF-044).
 *
 * @server-only — Must never be imported from a "use client" file.
 * See ADR-0010.
 *
 * This module is the narrow, shared foundation for page guards and API guards.
 * It owns:
 *
 *  - {@link AuthResult} — shared discriminated union for API guard return values.
 *  - {@link loadSession} — bare session fetch with NO redirect or response side
 *    effects; callers choose the failure path appropriate for their environment.
 *  - {@link sessionHasCapability} — capability check against an already-loaded
 *    session.
 */
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/config";
import { hasCapability, type Capability } from "@/lib/rbac";

/**
 * Discriminated-union result type for API auth guards.
 * When `error` is absent the session is always present and the caller can
 * proceed. When `error` is present the route must return it immediately; a
 * partial session may be present for audit purposes.
 */
export type AuthResult =
  | { session: Session; error?: undefined }
  | { session?: Session; error: NextResponse };

function hasSessionUser(session: Session | null): session is Session {
  return Boolean(session?.user);
}

/**
 * Loads the current server session. Returns `null` if there is no authenticated
 * user. Has no redirect or `NextResponse` side effects.
 */
export async function loadSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  return hasSessionUser(session) ? session : null;
}

/**
 * Returns `true` if the loaded session grants the named capability. A `null`
 * session is always denied (deny-by-default).
 */
export function sessionHasCapability(
  session: Session | null,
  capability: Capability,
): boolean {
  return session !== null && hasCapability(session.user, capability);
}
