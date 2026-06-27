"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
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
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        onClick={open}
        aria-label={sharedLabel}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        leadingIcon={<Search size={16} aria-hidden className="shrink-0" />}
        trailingIcon={
          modKey !== null ? (
            <span className="kbd" aria-hidden suppressHydrationWarning>
              {modKey === "⌘" ? "⌘K" : "Ctrl K"}
            </span>
          ) : undefined
        }
        className={cn(
          "hidden min-w-[200px] max-w-[240px] justify-start bg-bg-subtle text-text-muted hover:bg-surface hover:text-text sm:inline-flex",
          "[&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:text-left",
        )}
      >
        Search…
      </Button>

      {/* Mobile: icon-only button (resolves M2 N4 — search reachable below 640px) */}
      <IconButton
        onClick={open}
        aria-label={sharedLabel}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="h-10 w-10 rounded-[var(--radius-md)] text-text-muted hover:text-text sm:hidden"
      >
        <Search size={20} aria-hidden />
      </IconButton>
    </>
  );
}
