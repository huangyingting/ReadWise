"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { useCommandPalette } from "@/components/command/CommandPaletteProvider";

/**
 * Header search affordance (M9). Replaces the disabled placeholder button.
 *
 * Desktop (≥ 640px): a faux search-box button with a ⌘K keycap chip.
 * Mobile (< 640px):  an icon-only button (resolves M2 N4).
 *
 * Both call `useCommandPalette().open()`, which mounts the CommandPalette.
 */
export default function HeaderSearch() {
  const { open } = useCommandPalette();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [modKey, setModKey] = useState<string | null>(null);

  // Detect platform after mount to avoid SSR/hydration mismatch
  useEffect(() => {
    const isMac =
      typeof navigator !== "undefined" &&
      (navigator.userAgent.includes("Mac") ||
        // @ts-expect-error — userAgentData is not yet in TS lib but is widely supported
        navigator.userAgentData?.platform === "macOS");
    setModKey(isMac ? "⌘" : "Ctrl");
  }, []);

  const sharedLabel = "Search articles, pages, and actions";

  return (
    <>
      {/* Desktop/tablet: faux search-box (hidden on mobile) */}
      <button
        ref={buttonRef}
        type="button"
        onClick={open}
        aria-label={sharedLabel}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "hidden sm:inline-flex items-center gap-[var(--space-2)]",
          "h-9 px-[var(--space-3)] min-w-[200px] max-w-[240px]",
          "rounded-[var(--radius-md)] border border-border",
          "bg-bg-subtle text-text-subtle",
          "transition-[background,border-color,color] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
          "hover:bg-surface hover:border-border-strong hover:text-text-muted",
          focusRing,
        )}
      >
        <Search size={16} aria-hidden className="shrink-0" />
        <span className="flex-1 text-left text-[length:var(--text-sm)] truncate">
          Search…
        </span>
        {/* ⌘K / Ctrl+K chip — rendered client-side only to avoid hydration mismatch */}
        {modKey !== null && (
          <span
            className="shrink-0 kbd"
            aria-hidden
            suppressHydrationWarning
          >
            {modKey === "⌘" ? "⌘K" : "Ctrl K"}
          </span>
        )}
      </button>

      {/* Mobile: icon-only button (resolves M2 N4 — search reachable below 640px) */}
      <button
        type="button"
        onClick={open}
        aria-label={sharedLabel}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "sm:hidden inline-flex items-center justify-center h-10 w-10 shrink-0",
          "rounded-[var(--radius-md)] text-text-muted",
          "hover:bg-bg-subtle active:bg-bg-subtle",
          "transition-colors [transition-duration:var(--duration-fast)]",
          focusRing,
        )}
      >
        <Search size={20} aria-hidden />
      </button>
    </>
  );
}
