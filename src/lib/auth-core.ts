/**
 * Shared auth core (REF-044).
 *
 * @server-only — Must never be imported from a "use client" file.
 * See ADR-0010.
 *
 * This module is the narrow, shared foundation for the page guards
 * (`@/lib/session`) and the API guards (`@/lib/api-auth`). It owns:
 *
 *  - {@link AuthResult} — shared discriminated union for API guard return values.
 *  - {@link loadSession} — bare session fetch with NO redirect or response side
 *    effects; callers choose the failure path appropriate for their environment.
 *  - {@link sessionHasCapability} — capability check against an already-loaded
 *    session.
 *
 * Layer summary
 * ─────────────
 *  `@/lib/rbac`      — pure capability/role model (no I/O)
 *  `@/lib/auth-core` — session loading + capability helper (this module)
 *  `@/lib/session`   — page guards: redirect on failure (server components)
 *  `@/lib/api-auth`  — API guards: NextResponse 401/403 on failure (route handlers)
 *
 * When to use each:
 *  - Missing session on a page → redirect to `/signin` (session.ts).
 *  - Missing session in an API route → return 401 (api-auth.ts).
 *  - Service/utility checking a loaded session → `sessionHasCapability` directly.
 */

import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasCapability, type Capability } from "@/lib/rbac";

/**
 * Discriminated-union result type for API auth guards (see `@/lib/api-auth`).
 * When `error` is absent the session is always present and the caller can
 * proceed. When `error` is present the route must return it immediately; a
 * partial session may be present for audit purposes.
 */
export type AuthResult =
  | { session: Session; error?: undefined }
  | { session?: Session; error: NextResponse };

/**
 * Loads the current server session. Returns `null` if there is no authenticated
 * user. Has **no** redirect or `NextResponse` side effects — callers decide the
 * appropriate failure response for their context (redirect vs 401).
 */
export async function loadSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  return session?.user ? session : null;
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
