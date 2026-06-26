/**
 * Session guards — page-level auth helpers.
 *
 * @server-only — Must never be imported from a "use client" file.
 * For server components and RSC-aware pages/layouts only.
 * See docs/refactoring.md § REF-076.
 */
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { isUserOnboarded } from "@/lib/profile";
import type { Capability } from "@/lib/rbac";
import { loadSession, sessionHasCapability } from "@/lib/auth-core";

export async function requireSession(callbackUrl: string): Promise<Session> {
  const session = await loadSession();
  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return session;
}

export async function requireOnboardedSession(
  callbackUrl: string,
): Promise<Session> {
  const session = await requireSession(callbackUrl);
  if (!(await isUserOnboarded(session.user.id))) {
    redirect("/onboarding");
  }
  return session;
}

/**
 * Requires the session to hold a named capability (RW-011). Authenticated users
 * lacking the capability are redirected to `/forbidden`. This is the
 * capability-based replacement for hard-coded role checks; gate admin features
 * on a specific {@link Capability} (e.g. `articles.manage`) rather than a role.
 */
export async function requireCapability(
  capability: Capability,
  callbackUrl: string,
): Promise<Session> {
  const session = await requireSession(callbackUrl);
  if (!sessionHasCapability(session, capability)) {
    redirect("/forbidden");
  }
  return session;
}

