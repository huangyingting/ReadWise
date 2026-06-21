import HeaderShell from "./HeaderShell";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import MobileDrawer from "./MobileDrawer";
import HeaderSearch from "./HeaderSearch";
import { WordmarkLink } from "@/components/Wordmark";
import type { ShellUser } from "./types";

/**
 * Top app bar — chrome only (US #150): wordmark on the left, the search / theme
 * / user action cluster on the right, nothing in the center. Primary navigation
 * lives in the left sidebar on md+ (AppSidebar); below md the MobileDrawer
 * hamburger still owns nav (retired separately in #151). The header carries no
 * primary nav links on any breakpoint.
 */
export default function AppHeader({ user }: { user: ShellUser | null }) {
  return (
    <HeaderShell>
      <div className="flex min-w-0 items-center gap-[var(--space-4)]">
        {user ? <MobileDrawer user={user} /> : null}
        <WordmarkLink />
      </div>

      <div className="flex shrink-0 items-center gap-[var(--space-2)]">
        <HeaderSearch />
        <ThemeToggle />
        {user ? <UserMenu user={user} /> : null}
      </div>
    </HeaderShell>
  );
}
