"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/focus-trap";

export interface SheetProps {
  /** Whether the sheet is rendered. When false, nothing renders. */
  open: boolean;
  /** Called when the user requests to close (Esc or scrim click). */
  onClose: () => void;
  /** Which edge the panel anchors to. Defaults to "right". */
  side?: "left" | "right" | "bottom";
  /** Accessible label for the dialog (announced by screen readers). */
  label: string;
  /** Panel contents. */
  children: React.ReactNode;
}

/**
 * Accessible modal overlay sheet.
 *
 * Renders a scrim plus a `role="dialog" aria-modal="true"` panel that slides in
 * from a chosen edge. Moves focus into the panel on open, traps Tab/Shift+Tab,
 * closes on Esc or scrim click, and restores focus to the previously-focused
 * element on close. Honors `prefers-reduced-motion` (no transform animation when
 * reduced). Renders nothing when `open` is false.
 *
 * @example
 * <Sheet open={open} onClose={() => setOpen(false)} side="right" label="Filters">
 *   …panel content…
 * </Sheet>
 */
export function Sheet({
  open,
  onClose,
  side = "right",
  label,
  children,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open, onClose, { restoreFocus: true });

  if (!open) return null;

  const isBottom = side === "bottom";

  return (
    <div className="fixed inset-0 z-[var(--z-popover)]">
      {/* Scrim */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 bg-[var(--overlay)]"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "fixed flex flex-col bg-surface border-border shadow-[var(--shadow-xl)] outline-none",
          "motion-safe:transition-transform motion-safe:[transition-duration:var(--duration-slow)] motion-safe:[transition-timing-function:var(--ease-emphasized)]",
          side === "left" &&
            "inset-y-0 left-0 w-[min(420px,90vw)] border-r",
          side === "right" &&
            "inset-y-0 right-0 w-[min(420px,90vw)] border-l",
          isBottom &&
            "inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto border-t rounded-t-[var(--radius-xl)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
