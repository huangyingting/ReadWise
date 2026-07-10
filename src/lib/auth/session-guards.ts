/**
 * Session guards — page-level auth helpers.
 *
 * @server-only — Must never be imported from a "use client" file.
 * For server components and RSC-aware pages/layouts only.
 * See ADR-0010.
 */
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { isUserOnboarded } from "@/lib/profile";
import type { Capability } from "@/lib/rbac";
import { loadSession, sessionHasCapability } from "@/lib/auth/session-core";

const ONBOARDING_PATH = "/onboarding";
const FORBIDDEN_PATH = "/forbidden";

function signInPath(callbackUrl: string): string {
  return `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export async function requireSession(callbackUrl: string): Promise<Session> {
  const session = await loadSession();
  if (!session) {
    redirect(signInPath(callbackUrl));
  }
  return session;
}

export async function requireOnboardedSession(
  callbackUrl: string,
): Promise<Session> {
  const session = await requireSession(callbackUrl);
  if (!(await isUserOnboarded(session.user.id))) {
    redirect(ONBOARDING_PATH);
  }
  return session;
}

/**
 * Requires the session to hold a named capability (RW-011). Authenticated users
 * lacking the capability are redirected to `/forbidden`.
 */
export async function requireCapability(
  capability: Capability,
  callbackUrl: string,
): Promise<Session> {
  const session = await requireSession(callbackUrl);
  if (!sessionHasCapability(session, capability)) {
    redirect(FORBIDDEN_PATH);
  }
  return session;
}
