import Link from "next/link";
import { Search } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import HeaderShell from "./HeaderShell";
import AppNav from "./AppNav";
import ThemeToggle from "./ThemeToggle";
import UserMenu from "./UserMenu";
import MobileDrawer from "./MobileDrawer";
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
        <AppNav />
      </div>

      <div className="flex items-center gap-[var(--space-2)]">
        {/* Search placeholder — reserved for M4; disabled no-op. */}
        <button
          type="button"
          disabled
          aria-label="Search (coming soon)"
          className="hidden sm:inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-[var(--radius-md)] text-text-subtle opacity-50 cursor-not-allowed"
        >
          <Search size={20} aria-hidden />
        </button>
        <ThemeToggle />
        {user ? <UserMenu user={user} /> : null}
      </div>
    </HeaderShell>
  );
}
