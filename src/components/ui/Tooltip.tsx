"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type TooltipSide = "top" | "bottom" | "left" | "right";

const tooltipSideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1",
  left: "right-full top-1/2 -translate-y-1/2 mr-1",
  right: "left-full top-1/2 -translate-y-1/2 ml-1",
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
}

/**
 * Lightweight accessible tooltip.
 *
 * Replaces native `title=""` attributes: keyboard-visible, dark-mode aware,
 * respects prefers-reduced-motion. Attaches `aria-describedby` to the trigger
 * while the tooltip is open so screen readers announce the content.
 *
 * Note: children are rendered untouched so Server Component content can be
 * passed through safely. For complex popovers or rich content, a full
 * portal-based solution is a recommended follow-up.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const wrapperRef = React.useRef<HTMLSpanElement>(null);
  const describedElementRef = React.useRef<HTMLElement | null>(null);

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
      className="relative inline-flex"
      onMouseEnter={(event) => openTooltip(event.target)}
      onMouseLeave={closeTooltip}
      onFocus={(event) => openTooltip(event.target)}
      onBlur={closeTooltip}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute z-[var(--z-overlay)] px-[var(--space-2)] py-[var(--space-1)]",
            "rounded-[var(--radius-sm)]",
            "text-[length:var(--text-xs)] text-text-inverted whitespace-nowrap",
            "bg-[color:var(--text)] shadow-[var(--shadow-md)]",
            "pointer-events-none motion-reduce:transition-none",
            tooltipSideClasses[side],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
