import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { countPendingAssignmentsForStudent } from "@/lib/classroom/queries";
import AppShell from "@/components/shell/AppShell";
import type { ShellUser } from "@/components/shell/types";

type SessionUser = NonNullable<Session["user"]>;

function toShellUser(
  sessionUser: SessionUser,
  showTodayNav: boolean,
  pendingAssignmentCount: number,
): ShellUser {
  return {
    name: sessionUser.name,
    email: sessionUser.email,
    image: sessionUser.image,
    role: sessionUser.role,
    showTodayNav,
    pendingAssignmentCount,
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
 *
 * `pendingAssignmentCount` is derived here (server-only) and threaded through
 * ShellUser so client shell components never import server-only classroom/prisma
 * modules. Falls back to 0 on any query hiccup so a slow/failing DB never
 * breaks the shell render.
 */
export default async function AppGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const showTodayNav = isTodaySessionFeatureEnabled();

  let pendingAssignmentCount = 0;
  if (session?.user?.id) {
    try {
      pendingAssignmentCount = await countPendingAssignmentsForStudent(session.user.id);
    } catch {
      // Graceful fallback — badge omitted rather than breaking the shell.
    }
  }

  const user: ShellUser | null = session?.user
    ? toShellUser(session.user, showTodayNav, pendingAssignmentCount)
    : null;

  return <AppShell user={user}>{children}</AppShell>;
}
