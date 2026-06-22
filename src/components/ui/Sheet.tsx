"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

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

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Collect the genuinely tabbable elements inside `root`.
 *
 * The CSS selector alone is not enough: roving-tabindex widgets (e.g.
 * `SegmentedControl`) render their inactive options as real `<button>`s with
 * `tabindex="-1"`, which the selector still matches. Including them would make
 * the computed "last focusable" an unreachable element, so Tab-wrap never fires
 * and focus escapes the trap. Filter to elements actually in the tab order
 * (`el.tabIndex >= 0`).
 */
function getTabbable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.tabIndex >= 0);
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

  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the panel: first focusable, else the panel itself.
    const first = getTabbable(panelRef.current)[0];
    if (first) {
      first.focus();
    } else {
      panelRef.current?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = getTabbable(panelRef.current);
      if (list.length === 0) {
        // Keep focus on the panel when there is nothing else to tab to.
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || active === panelRef.current)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const isBottom = side === "bottom";

  return (
    <div className="fixed inset-0 z-[60]">
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
