import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import AppShell from "@/components/shell/AppShell";
import type { ShellUser } from "@/components/shell/types";

type SessionUser = NonNullable<Session["user"]>;

function toShellUser(sessionUser: SessionUser, showTodayNav: boolean): ShellUser {
  return {
    name: sessionUser.name,
    email: sessionUser.email,
    image: sessionUser.image,
    role: sessionUser.role,
    showTodayNav,
  };
}

/**
 * Route-group layout for the authenticated, reader-facing pages. Reads the
 * session for DISPLAY ONLY (user menu + role-gated admin link) — it does NOT
 * gate access. Each page keeps its own `requireSession`/`requireOnboarded`
 * gate with the correct callbackUrl, so a null session here renders the shell
 * without the user menu while the page-level redirect takes over.
 *
 * `showTodayNav` is derived here (server-only) and threaded through ShellUser
 * so client shell components never import server runtime config.
 */
export default async function AppGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const showTodayNav = isTodaySessionFeatureEnabled();
  const user: ShellUser | null = session?.user
    ? toShellUser(session.user, showTodayNav)
    : null;

  return <AppShell user={user}>{children}</AppShell>;
}
