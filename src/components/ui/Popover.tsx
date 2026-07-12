"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/focus-trap";
import {
  computePopoverLayout,
  type PopoverViewport,
} from "@/components/ui/popover-layout";

const ROVING_ITEM_SELECTOR = '[role="menuitem"], [role="option"]';
const GAP_FALLBACK_PX = 8;
const VIEWPORT_PADDING_FALLBACK_PX = 12;

function containsEventTarget(
  ref: React.RefObject<HTMLElement | null>,
  target: Node,
) {
  return ref.current?.contains(target) ?? false;
}

function nextRovingItem(
  items: HTMLElement[],
  activeElement: Element | null,
  direction: 1 | -1,
) {
  const currentIndex = items.indexOf(activeElement as HTMLElement);
  return (
    items[(currentIndex + direction + items.length) % items.length] ?? items[0]!
  );
}

function readCssLengthPx(variable: string, fallbackPx: number): number {
  if (typeof window === "undefined") return fallbackPx;
  const root = document.documentElement;
  const cssValue = getComputedStyle(root).getPropertyValue(variable).trim();
  if (!cssValue) return fallbackPx;

  const numeric = Number.parseFloat(cssValue);
  if (!Number.isFinite(numeric)) return fallbackPx;

  if (cssValue.endsWith("rem")) {
    const rootFontPx = Number.parseFloat(getComputedStyle(root).fontSize);
    if (!Number.isFinite(rootFontPx)) return fallbackPx;
    return numeric * rootFontPx;
  }

  return numeric;
}

function currentViewport(): PopoverViewport {
  if (typeof window === "undefined") {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const visualViewport = window.visualViewport;
  if (visualViewport) {
    return {
      left: visualViewport.offsetLeft,
      top: visualViewport.offsetTop,
      width: visualViewport.width,
      height: visualViewport.height,
    };
  }

  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
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
  children,
}: PopoverProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;

    function applyLayout() {
      const nextAnchor = anchorRef.current;
      const nextPanel = panelRef.current;
      if (!nextAnchor || !nextPanel) return;

      const viewport = currentViewport();
      const gap = readCssLengthPx("--space-2", GAP_FALLBACK_PX);
      const viewportPadding = readCssLengthPx(
        "--space-3",
        VIEWPORT_PADDING_FALLBACK_PX,
      );
      const naturalWidth = Math.max(nextPanel.offsetWidth, nextPanel.scrollWidth);
      const naturalHeight = Math.max(nextPanel.offsetHeight, nextPanel.scrollHeight);
      const layout = computePopoverLayout({
        anchorRect: nextAnchor.getBoundingClientRect(),
        panelWidth: naturalWidth,
        panelHeight: naturalHeight,
        viewport,
        align,
        gap,
        viewportPadding,
      });

      nextPanel.style.left = `${layout.left}px`;
      nextPanel.style.top = `${layout.top}px`;
      nextPanel.style.maxHeight = `${layout.maxHeight}px`;
      nextPanel.style.maxWidth = `${layout.maxWidth}px`;
      nextPanel.dataset.popoverPlacement = layout.placement;
    }

    function scheduleLayout() {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyLayout();
      });
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleLayout)
        : null;
    resizeObserver?.observe(panel);
    resizeObserver?.observe(anchor);

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("orientationchange", scheduleLayout);
    window.addEventListener("scroll", scheduleLayout, true);
    visualViewport?.addEventListener("resize", scheduleLayout);
    visualViewport?.addEventListener("scroll", scheduleLayout);

    scheduleLayout();

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      window.removeEventListener("orientationchange", scheduleLayout);
      window.removeEventListener("scroll", scheduleLayout, true);
      visualViewport?.removeEventListener("resize", scheduleLayout);
      visualViewport?.removeEventListener("scroll", scheduleLayout);
    };
  }, [open, anchorRef, align]);

  useFocusTrap(panelRef, open, onClose, {
    restoreFocus: true,
    stopEscapePropagation: true,
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

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items =
          panelRef.current?.querySelectorAll<HTMLElement>(ROVING_ITEM_SELECTOR);
        if (!items || items.length === 0) return;
        event.preventDefault();
        const list = Array.from(items);
        const dir = event.key === "ArrowDown" ? 1 : -1;
        const next = nextRovingItem(list, document.activeElement, dir);
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
      tabIndex={-1}
      className={cn(
        "fixed z-[var(--z-popover)] min-w-[200px] overflow-y-auto",
        "rounded-[var(--radius-md)] border border-border bg-surface py-[var(--space-1)]",
        "shadow-[var(--shadow-lg)]",
      )}
    >
      {children}
    </div>
  );
}
