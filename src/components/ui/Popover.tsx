"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/focus-trap";
import { useRovingTabindex } from "@/lib/use-roving-tabindex";
import { useFloatingPosition } from "./useFloatingPosition";

const ROVING_ITEM_SELECTOR = '[role="menuitem"], [role="option"]';

function containsEventTarget(
  ref: React.RefObject<HTMLElement | null>,
  target: Node,
) {
  return ref.current?.contains(target) ?? false;
}

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
  /** Match the panel width to the anchor. Defaults to false. */
  matchAnchorWidth?: boolean;
  /** Element to focus when the panel opens. Defaults to the first tabbable item. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Additional token-driven classes for the popover panel. */
  className?: string;
  /** Panel contents. */
  children: React.ReactNode;
}

/**
 * Anchored, non-modal popover panel.
 *
 * Renders a `role="dialog"` panel anchored to `anchorRef` with viewport-aware
 * placement and clamping. The panel prefers below-placement, flips above when
 * needed, and applies internal scrolling when neither side has enough room.
 * Closes on outside pointerdown (outside both anchor and panel) and on Esc,
 * returning focus to the anchor. Traps Tab focus while open, and supports
 * optional ArrowUp/ArrowDown roving over child items with `role="menuitem"` or
 * `role="option"` (wraps at ends). Renders nothing when `open` is false.
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
  matchAnchorWidth = false,
  initialFocusRef,
  className,
  children,
}: PopoverProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  useFloatingPosition(panelRef, anchorRef, {
    active: open,
    placement: "below",
    align,
    constrainSize: true,
    matchAnchorWidth,
  });

  useFocusTrap(panelRef, open, onClose, {
    restoreFocus: true,
    stopEscapePropagation: true,
    initialFocusRef,
  });

  const { handleKeyDown } = useRovingTabindex(panelRef, {
    selector: ROVING_ITEM_SELECTOR,
    orientation: "vertical",
    homeEnd: true,
  });

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        containsEventTarget(anchorRef, target)
      ) {
        return;
      }
      onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        "fixed z-[var(--z-popover)] min-w-[200px] overflow-y-auto",
        "rounded-[var(--radius-md)] border border-border bg-surface py-[var(--space-1)]",
        "shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
