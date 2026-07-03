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

export interface TooltipProps {
  /** The tooltip text shown on hover/focus. */
  content: React.ReactNode;
  /** The trigger element — must be able to receive focus. */
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
 * Note: for complex popovers or rich content, a full portal-based solution is
 * a recommended follow-up.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const childProps = children.props;

  const trigger = React.cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter(event: React.MouseEvent<HTMLElement>) {
      setOpen(true);
      childProps.onMouseEnter?.(event);
    },
    onMouseLeave(event: React.MouseEvent<HTMLElement>) {
      setOpen(false);
      childProps.onMouseLeave?.(event);
    },
    onFocus(event: React.FocusEvent<HTMLElement>) {
      setOpen(true);
      childProps.onFocus?.(event);
    },
    onBlur(event: React.FocusEvent<HTMLElement>) {
      setOpen(false);
      childProps.onBlur?.(event);
    },
  });

  return (
    <span className="relative inline-flex">
      {trigger}
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
