"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  /** The tooltip text shown on hover/focus. */
  content: React.ReactNode;
  /** The trigger element — must be able to receive focus. */
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  /** Preferred placement relative to the trigger. */
  side?: "top" | "bottom" | "left" | "right";
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

  const trigger = React.cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onMouseEnter(e: React.MouseEvent) {
      setOpen(true);
      (children.props as React.HTMLAttributes<HTMLElement>).onMouseEnter?.(e as React.MouseEvent<HTMLElement>);
    },
    onMouseLeave(e: React.MouseEvent) {
      setOpen(false);
      (children.props as React.HTMLAttributes<HTMLElement>).onMouseLeave?.(e as React.MouseEvent<HTMLElement>);
    },
    onFocus(e: React.FocusEvent) {
      setOpen(true);
      (children.props as React.HTMLAttributes<HTMLElement>).onFocus?.(e as React.FocusEvent<HTMLElement>);
    },
    onBlur(e: React.FocusEvent) {
      setOpen(false);
      (children.props as React.HTMLAttributes<HTMLElement>).onBlur?.(e as React.FocusEvent<HTMLElement>);
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
            side === "top" && "bottom-full left-1/2 -translate-x-1/2 mb-1",
            side === "bottom" && "top-full left-1/2 -translate-x-1/2 mt-1",
            side === "left" && "right-full top-1/2 -translate-y-1/2 mr-1",
            side === "right" && "left-full top-1/2 -translate-y-1/2 ml-1",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
