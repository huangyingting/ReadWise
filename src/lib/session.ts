import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isUserOnboarded } from "@/lib/profile";
import { CAPABILITIES, hasCapability, type Capability } from "@/lib/rbac";

export async function requireSession(callbackUrl: string): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
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
  if (!hasCapability(session.user, capability)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireAdmin(callbackUrl: string): Promise<Session> {
  return requireCapability(CAPABILITIES.adminAccess, callbackUrl);
}
