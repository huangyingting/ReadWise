import type { ReactNode } from "react";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import AppShell from "@/components/shell/AppShell";
import { PageShell } from "@/components/ui";
import AdminNav from "@/components/AdminNav";
import type { ShellUser } from "@/components/shell/types";

/**
 * Admin layout — renders the admin area INSIDE the unified app shell (sidebar +
 * chrome header on md+, mobile bottom tab bar), consistent with the rest of the
 * app. Gates the whole area with `admin.access` (defence-in-depth: each page
 * also requires its own capability) and reuses the returned session to derive
 * the display-only shell user exactly like the `(app)` route group.
 *
 * `AdminNav` is demoted to an in-content secondary sub-nav rendered above the
 * page content inside the shell's main column.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  const user: ShellUser = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    role: session.user.role,
  };

  return (
    <AppShell user={user}>
      <PageShell>
        <AdminNav />
        {children}
      </PageShell>
    </AppShell>
  );
}
