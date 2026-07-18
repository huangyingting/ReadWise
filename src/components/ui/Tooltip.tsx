"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import type { FloatingPlacement } from "./floating-layout";
import { useFloatingPosition } from "./useFloatingPosition";

type TooltipSide = "top" | "bottom" | "left" | "right";

/** Gap in px between the trigger and the tooltip bubble. */
const TOOLTIP_OFFSET = 6;
/** Minimum gap in px between the tooltip and the viewport edge. */
const VIEWPORT_PADDING = 4;

const TOOLTIP_PLACEMENT: Record<TooltipSide, FloatingPlacement> = {
  top: "above",
  bottom: "below",
  left: "left",
  right: "right",
};

const focusableTriggerSelector =
  "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export interface TooltipProps {
  /** The tooltip text shown on hover/focus. */
  content: React.ReactNode;
  /** The trigger content. Focusable descendants open the tooltip via bubbling focus events. */
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  /** Preferred placement relative to the trigger. */
  side?: TooltipSide;
  /**
   * Allow long content to wrap within the viewport-safe tooltip width.
   * Defaults to true; disable for compact labels that must stay on one line.
   */
  wrap?: boolean;
  /**
   * Extra classes for the wrapper element. Defaults to `relative inline-flex`;
   * pass layout overrides (e.g. `w-full`, `block`, or absolute-position classes)
   * when the trigger needs to preserve its original box in the layout/flow.
   */
  className?: string;
}

/**
 * Lightweight accessible tooltip.
 *
 * Replaces native `title=""` attributes: keyboard-visible, dark-mode aware,
 * respects prefers-reduced-motion. Attaches `aria-describedby` to the trigger
 * while the tooltip is open so screen readers announce the content.
 *
 * Children are rendered untouched so Server Component content can be passed
 * through safely. Use Popover rather than Tooltip for interactive content.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  wrap = true,
  className,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const id = React.useId();
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const describedElementRef = React.useRef<HTMLElement | null>(null);

  useFloatingPosition(tooltipRef, wrapperRef, {
    active: open && mounted,
    placement: TOOLTIP_PLACEMENT[side],
    align: "center",
    gap: TOOLTIP_OFFSET,
    viewportPadding: VIEWPORT_PADDING,
    flip: false,
  });

  React.useEffect(() => setMounted(true), []);

  const removeDescription = React.useCallback(() => {
    const element = describedElementRef.current;
    if (!element) return;

    const describedBy = element.getAttribute("aria-describedby");
    const nextTokens = (describedBy ?? "")
      .split(/\s+/)
      .filter((token) => token && token !== id);

    if (nextTokens.length > 0) {
      element.setAttribute("aria-describedby", nextTokens.join(" "));
    } else {
      element.removeAttribute("aria-describedby");
    }
    describedElementRef.current = null;
  }, [id]);

  const getTriggerElement = React.useCallback(
    (target: EventTarget | null): HTMLElement | null => {
      const wrapper = wrapperRef.current;
      if (target instanceof HTMLElement && wrapper) {
        const nearestFocusable = target.closest<HTMLElement>(focusableTriggerSelector);
        if (nearestFocusable && wrapper.contains(nearestFocusable)) {
          return nearestFocusable;
        }
      }

      const focusable = wrapper?.querySelector<HTMLElement>(focusableTriggerSelector);
      if (focusable) return focusable;

      return wrapper?.firstElementChild instanceof HTMLElement
        ? wrapper.firstElementChild
        : null;
    },
    [],
  );

  const attachDescription = React.useCallback(
    (trigger: HTMLElement | null) => {
      if (describedElementRef.current && describedElementRef.current !== trigger) {
        removeDescription();
      }
      if (!trigger) return;

      const tokens = (trigger.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean);
      if (!tokens.includes(id)) {
        trigger.setAttribute("aria-describedby", [...tokens, id].join(" "));
      }
      describedElementRef.current = trigger;
    },
    [id, removeDescription],
  );

  const openTooltip = React.useCallback(
    (target: EventTarget | null) => {
      setOpen(true);
      attachDescription(getTriggerElement(target));
    },
    [attachDescription, getTriggerElement],
  );

  const closeTooltip = React.useCallback(() => {
    setOpen(false);
    removeDescription();
  }, [removeDescription]);

  React.useEffect(() => removeDescription, [removeDescription]);

  return (
    <span
      ref={wrapperRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={(event) => openTooltip(event.target)}
      onMouseLeave={closeTooltip}
      onFocus={(event) => openTooltip(event.target)}
      onBlur={closeTooltip}
    >
      {children}
      {open && mounted
        ? createPortal(
            <div
              ref={tooltipRef}
              id={id}
              role="tooltip"
              style={{
                position: "fixed",
                top: -9999,
                left: -9999,
                maxWidth: wrap
                  ? "min(var(--tooltip-max-w), calc(100vw - var(--space-8)))"
                  : undefined,
              }}
              className={cn(
                "z-[var(--z-overlay)] px-[var(--space-2)] py-[var(--space-1)]",
                "rounded-[var(--radius-sm)]",
                "text-[length:var(--text-xs)] text-text-inverted",
                "bg-[color:var(--text)] shadow-[var(--shadow-md)]",
                "pointer-events-none motion-reduce:transition-none",
                wrap
                  ? "whitespace-normal break-words text-left"
                  : "whitespace-nowrap",
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
