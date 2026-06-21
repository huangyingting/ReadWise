import type { ReactNode } from "react";
import AppHeader from "./AppHeader";
import AppFooter from "./AppFooter";
import AppSidebar from "./AppSidebar";
import CommandPaletteProvider from "@/components/command/CommandPaletteProvider";
import type { ShellUser } from "./types";

/**
 * Global app shell: full-width sticky header on top, then a row below with the
 * collapsible left sidebar (md+) and the main content column on the right, plus
 * a self-hiding footer. Server component — receives the session-derived
 * (display-only) user from the route-group layout; a null user renders the
 * chrome without the user menu. CommandPaletteProvider mounts here (authed app
 * surface only) and exposes the ⌘K palette to every page in the (app) route
 * group.
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
        {/* Skip link — first focusable element, visible on focus (WCAG 2.4.1). */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AppHeader user={user} />
        <div className="flex flex-1 flex-row">
          {user ? <AppSidebar user={user} /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <main id="main-content" className="flex-1" tabIndex={-1}>
              {children}
            </main>
            <AppFooter />
          </div>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}
