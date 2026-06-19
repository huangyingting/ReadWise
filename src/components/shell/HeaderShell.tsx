"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Sticky header shell. Adds an elevation shadow once the page scrolls past a
 * small threshold (Saul's spec: 4px); at the top it shows only a bottom border.
 * Kept as a thin client island so AppHeader can stay a server component.
 */
export default function HeaderShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-surface",
        "transition-shadow [transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
        scrolled
          ? "shadow-[var(--shadow-md)] border-b border-transparent"
          : "border-b border-border",
      )}
    >
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-[var(--space-4)] px-[var(--space-6)]">
        {children}
      </div>
    </header>
  );
}
