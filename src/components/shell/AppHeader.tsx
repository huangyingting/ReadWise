import HeaderShell from "./HeaderShell";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import MobileDrawer from "./MobileDrawer";
import HeaderSearch from "./HeaderSearch";
import { WordmarkLink } from "@/components/Wordmark";
import type { ShellUser } from "./types";

/**
 * Top app bar: wordmark + the right cluster of actions. Primary navigation now
 * lives in the left sidebar on md+ (AppSidebar); below md the MobileDrawer
 * hamburger still owns nav. The header center is a flex spacer.
 */
export default function AppHeader({ user }: { user: ShellUser | null }) {
  return (
    <HeaderShell>
      <div className="flex items-center gap-[var(--space-4)]">
        {user ? <MobileDrawer user={user} /> : null}
        <WordmarkLink />
      </div>

      <div className="flex flex-1" />

      <div className="flex items-center gap-[var(--space-2)]">
        <HeaderSearch />
        <ThemeToggle />
        {user ? <UserMenu user={user} /> : null}
      </div>
    </HeaderShell>
  );
}
