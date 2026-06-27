"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui";
import { cn, focusRing } from "@/lib/cn";
import { PRIMARY_TABS, isActivePath } from "./nav-items";
import MoreSheet from "./MoreSheet";
import type { ShellUser } from "./types";

/** Dashboard reads as "Home" in the compact bottom bar (href stays /dashboard). */
const TAB_LABELS: Record<string, string> = {
  "/dashboard": "Home",
};

/**
 * Mobile primary navigation — a fixed bottom tab bar visible only below `md`.
 * Renders the four `PRIMARY_TABS` (Home/Browse/Study/Progress) plus a "More"
 * button that opens the `MoreSheet` (secondary + utility actions). The desktop
 * sidebar owns nav at `md+`, so this self-hides there. Sits below modal sheets
 * (z-[var(--z-overlay)] < Sheet's z-[var(--z-popover)]). Safe-area aware via
 * `env(safe-area-inset-bottom)`. */
export default function BottomTabBar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the More sheet on navigation.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // #153: hide the bottom tab bar inside the reader (focused reading) so it
  // never collides with the fixed ReaderMiniPlayer / reading toolbar. The reader
  // owns its own bottom chrome (mini-player + Tools sheet) on mobile.
  if (pathname?.startsWith("/reader/")) {
    return null;
  }

  const itemClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-[2px]",
      "min-h-[44px] px-[var(--space-1)] py-[var(--space-1)]",
      "text-[length:var(--text-xs)] font-medium",
      "transition-colors [transition-duration:var(--duration-fast)]",
      active ? "text-[var(--teal)]" : "text-text-muted hover:text-text",
      focusRing,
    );

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "md:hidden fixed inset-x-0 bottom-0 z-[var(--z-overlay)]",
          "flex items-stretch",
          "h-[var(--bottom-bar-h)] bg-surface border-t border-border",
          "[padding-bottom:env(safe-area-inset-bottom)]",
        )}
      >
        {PRIMARY_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={itemClass(active)}
            >
              <Icon size={22} aria-hidden />
              <span>{TAB_LABELS[href] ?? label}</span>
            </Link>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={itemClass(moreOpen)}
          leadingIcon={<MoreHorizontal size={22} aria-hidden />}
        >
          <span>More</span>
        </Button>
      </nav>

      <MoreSheet
        user={user}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
      />
    </>
  );
}
