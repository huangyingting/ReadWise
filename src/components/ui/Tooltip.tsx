"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type TooltipSide = "top" | "bottom" | "left" | "right";

/** Gap in px between the trigger and the tooltip bubble. */
const TOOLTIP_OFFSET = 6;
/** Minimum gap in px between the tooltip and the viewport edge. */
const VIEWPORT_PADDING = 4;

type Coords = { top: number; left: number };

function placeTooltip(
  side: TooltipSide,
  trigger: DOMRect,
  width: number,
  height: number,
): Coords {
  switch (side) {
    case "bottom":
      return {
        top: trigger.bottom + TOOLTIP_OFFSET,
        left: trigger.left + trigger.width / 2 - width / 2,
      };
    case "left":
      return {
        top: trigger.top + trigger.height / 2 - height / 2,
        left: trigger.left - width - TOOLTIP_OFFSET,
      };
    case "right":
      return {
        top: trigger.top + trigger.height / 2 - height / 2,
        left: trigger.right + TOOLTIP_OFFSET,
      };
    case "top":
    default:
      return {
        top: trigger.top - height - TOOLTIP_OFFSET,
        left: trigger.left + trigger.width / 2 - width / 2,
      };
  }
}

function clampToViewport(coords: Coords, width: number, height: number): Coords {
  if (typeof window === "undefined") return coords;
  const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - height - VIEWPORT_PADDING;
  return {
    left: Math.max(VIEWPORT_PADDING, Math.min(coords.left, maxLeft)),
    top: Math.max(VIEWPORT_PADDING, Math.min(coords.top, maxTop)),
  };
}

const focusableTriggerSelector =
  "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** Avoids the useLayoutEffect SSR warning while keeping pre-paint positioning on the client. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

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
  const [coords, setCoords] = React.useState<Coords | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const id = React.useId();
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const describedElementRef = React.useRef<HTMLElement | null>(null);

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

  const updatePosition = React.useCallback(() => {
    const anchor = wrapperRef.current?.firstElementChild ?? wrapperRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;
    const rect = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    setCoords(clampToViewport(placeTooltip(side, rect, width, height), width, height));
  }, [side]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onReflow = () => updatePosition();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(onReflow)
        : null;
    if (tooltipRef.current) resizeObserver?.observe(tooltipRef.current);
    if (wrapperRef.current) resizeObserver?.observe(wrapperRef.current);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, updatePosition]);

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
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
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
