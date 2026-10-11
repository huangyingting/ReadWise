import type { ReactNode } from "react";
import { requireCapability } from "@/lib/session";
import { CAPABILITIES } from "@/lib/rbac";
import AppShell from "@/components/shell/AppShell";
import { PageShell } from "@/components/ui";
import AdminNav from "@/components/AdminNav";
import type { ShellUser } from "@/components/shell/types";

type AdminLayoutProps = {
  children: ReactNode;
};

function toShellUser(session: Awaited<ReturnType<typeof requireCapability>>): ShellUser {
  return {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    role: session.user.role,
  };
}

/**
 * Admin layout — renders the admin area INSIDE the unified app shell (sidebar +
 * chrome header on md+, mobile bottom tab bar), consistent with the rest of the
 * app. Gates the whole area with `admin.access` (defence-in-depth: each page
 * also requires its own capability) and reuses the returned session to derive
 * the display-only shell user exactly like the `(app)` route group.
 *
 * `AdminNav` is an in-content secondary nav: a grouped sticky rail beside the
 * page content on lg+, and a compact picker/tab strip above it below lg. Admin
 * pages use the wide, compact page density.
 */
export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  const user = toShellUser(session);

  return (
    <AppShell user={user}>
      <PageShell variant="wide" density="compact">
        <div className="admin-layout">
          <AdminNav />
          <div className="min-w-0">{children}</div>
        </div>
      </PageShell>
    </AppShell>
  );
}
