"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface PopoverProps {
  /** Whether the popover is rendered. When false, nothing renders. */
  open: boolean;
  /** Called when the user requests to close (Esc or outside click). */
  onClose: () => void;
  /** The trigger element the panel anchors to; focus returns here on close. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Accessible label for the dialog (announced by screen readers). */
  label: string;
  /** Horizontal edge alignment relative to the anchor. Defaults to "end". */
  align?: "start" | "end";
  /** Panel contents. */
  children: React.ReactNode;
}

/**
 * Anchored, non-modal popover panel.
 *
 * Renders a `role="dialog"` panel absolutely positioned under the `anchorRef`
 * trigger. Closes on outside pointerdown (outside both anchor and panel) and on
 * Esc, returning focus to the anchor. Supports optional ArrowUp/ArrowDown roving
 * over child items with `role="menuitem"` or `role="option"` (wraps at ends).
 * Renders nothing when `open` is false.
 *
 * The anchor's nearest positioned ancestor should be `position: relative` (the
 * panel positions itself with `absolute` + `top-full`).
 *
 * @example
 * <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} label="Options">
 *   <button role="menuitem">…</button>
 * </Popover>
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  label,
  align = "end",
  children,
}: PopoverProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchorRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = panelRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="option"]',
        );
        if (!items || items.length === 0) return;
        event.preventDefault();
        const list = Array.from(items);
        const idx = list.indexOf(document.activeElement as HTMLElement);
        const dir = event.key === "ArrowDown" ? 1 : -1;
        const next = list[(idx + dir + list.length) % list.length] ?? list[0];
        next.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={cn(
        "absolute top-[calc(100%+var(--space-2))] z-[var(--z-popover)] min-w-[200px]",
        "rounded-[var(--radius-md)] border border-border bg-surface py-[var(--space-1)]",
        "shadow-[var(--shadow-lg)]",
        align === "end" ? "right-0" : "left-0",
      )}
    >
      {children}
    </div>
  );
}
