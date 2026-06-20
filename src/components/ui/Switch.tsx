"use client";

import * as React from "react";
import { cn, focusRing } from "@/lib/cn";

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Accessible pill toggle following the ARIA switch pattern.
 * Keyboard: Space/Enter toggle. Dark-mode via CSS tokens.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, onCheckedChange, disabled, className, ...props },
    ref,
  ) {
    function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!disabled) onCheckedChange(!checked);
      }
    }

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full",
          "border-2 border-transparent",
          "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-border-strong",
          focusRing,
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-white",
            "shadow-[var(--shadow-sm)]",
            "transition-transform [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);
