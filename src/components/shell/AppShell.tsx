import type { ReactNode } from "react";
import AppHeader from "./AppHeader";
import AppFooter from "./AppFooter";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import type { ShellUser } from "./types";

/**
 * Global app shell: sticky header + main content slot + self-hiding footer.
 * Server component — receives the session-derived (display-only) user from the
 * route-group layout; a null user renders the chrome without the user menu.
 * CommandPaletteProvider mounts here (authed app surface only) and exposes
 * the ⌘K palette to every page in the (app) route group.
 */
export default function AppShell({
  user,
  children,
}: {
  user: ShellUser | null;
  children: ReactNode;
}) {
  return (
    <CommandPaletteProvider user={user}>
      <div className="flex min-h-screen flex-col">
        <AppHeader user={user} />
        <div className="flex-1">{children}</div>
        <AppFooter />
      </div>
    </CommandPaletteProvider>
  );
}
