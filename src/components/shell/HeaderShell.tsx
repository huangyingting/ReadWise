"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const ELEVATION_SCROLL_THRESHOLD_PX = 4;
const HEADER_BASE_CLASS = "sticky top-0 z-[var(--z-overlay)] bg-bg";
const HEADER_TRANSITION_CLASS =
  "transition-shadow [transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]";

/**
 * Sticky header shell. Borderless chrome: at rest it shares the page --bg with
 * the sidebar; once the page scrolls past a small threshold (Saul's spec: 4px)
 * it gains an elevation shadow to separate it from content scrolling beneath.
 * Kept as a thin client island so AppHeader can stay a server component.
 */
export default function HeaderShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > ELEVATION_SCROLL_THRESHOLD_PX);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        HEADER_BASE_CLASS,
        HEADER_TRANSITION_CLASS,
        scrolled ? "shadow-[var(--shadow-sm)]" : "shadow-none",
      )}
    >
      <div className="flex h-[var(--header-height)] items-center justify-between gap-[var(--space-4)] pl-[var(--space-5)] pr-[var(--space-4)]">
        {children}
      </div>
    </header>
  );
}
