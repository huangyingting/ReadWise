import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import AppShell from "@/components/shell/AppShell";
import type { ShellUser } from "@/components/shell/types";

/**
 * Route-group layout for the authenticated, reader-facing pages. Reads the
 * session for DISPLAY ONLY (user menu + role-gated admin link) — it does NOT
 * gate access. Each page keeps its own `requireSession`/`requireOnboarded`
 * gate with the correct callbackUrl, so a null session here renders the shell
 * without the user menu while the page-level redirect takes over.
 */
export default async function AppGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const user: ShellUser | null = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        role: session.user.role,
      }
    : null;

  return <AppShell user={user}>{children}</AppShell>;
}
