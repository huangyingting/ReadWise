import Link from "next/link";
import { cn, focusRing } from "@/lib/cn";
import HeaderShell from "./HeaderShell";
import AppNav from "./AppNav";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import MobileDrawer from "./MobileDrawer";
import HeaderSearch from "./HeaderSearch";
import type { ShellUser } from "./types";

/** Top app bar: wordmark, primary nav, and the right cluster of actions. */
export default function AppHeader({ user }: { user: ShellUser | null }) {
  return (
    <HeaderShell>
      <div className="flex items-center gap-[var(--space-4)]">
        {user ? <MobileDrawer user={user} /> : null}
        <Link
          href="/dashboard"
          className={cn(
            "font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-text",
            "rounded-[var(--radius-sm)]",
            focusRing,
          )}
        >
          ReadWise
        </Link>
      </div>

      <div className="flex flex-1 justify-center">
        <AppNav user={user} />
      </div>

      <div className="flex items-center gap-[var(--space-2)]">
        <HeaderSearch />
        <ThemeToggle />
        {user ? <UserMenu user={user} /> : null}
      </div>
    </HeaderShell>
  );
}
