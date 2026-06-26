"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "@/lib/cn";

/**
 * Foreground tint per context. The component sets `--ib-fg` on the element so
 * hover:bg-[color-mix(…,var(--ib-fg)…)] can reference it without Tailwind
 * needing to parse nested var() fallbacks at class-scan time.
 */
const FG_MAP = {
  default: "var(--text)",
  reading: "var(--reading-text, var(--text))",
} as const;

const iconButtonVariants = cva(
  cn(
    "inline-flex items-center justify-center shrink-0",
    "border-none bg-transparent cursor-pointer select-none",
    "rounded-[var(--radius-sm)]",
    "transition-[background-color,color] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "disabled:opacity-[0.35] disabled:cursor-not-allowed disabled:pointer-events-none",
    "text-[color:var(--ib-fg)] hover:bg-[color-mix(in_srgb,var(--ib-fg)_10%,transparent)]",
    focusRing,
  ),
  {
    variants: {
      size: {
        /** 28 px — compact icon rows (e.g. note-row actions) */
        sm: "size-7",
        /** 32 px — standard reader/toolbar icon buttons */
        md: "size-8",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type IconButtonContext = keyof typeof FG_MAP;

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /**
   * Colour-tint context.
   * - `"default"` — `var(--text)` (general UI).
   * - `"reading"` — `var(--reading-text, var(--text))` (inside the reader;
   *   adapts across light/sepia/dark reading modes).
   */
  context?: IconButtonContext;
}

/**
 * Minimal square icon button with a centralised focus ring.
 *
 * Keyboard: native `<button>` — Space and Enter activate.
 * Focus: embeds `focusRing` (outline-none + focus-visible box-shadow ring).
 * Accessibility: always pass `aria-label` — the button renders no visible text.
 *
 * Variants:
 *   - `size`: `"sm"` (28 px) | `"md"` (32 px, default)
 *   - `context`: `"default"` (general) | `"reading"` (reading-text tint, default)
 *
 * @example
 * <IconButton aria-label="Close" onClick={onClose}><X size={16} /></IconButton>
 * <IconButton size="sm" context="reading" aria-label="Delete"><Trash2 size={14} /></IconButton>
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      size,
      context = "default",
      className,
      style,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        style={{ "--ib-fg": FG_MAP[context], ...style } as React.CSSProperties}
        className={cn(iconButtonVariants({ size }), className)}
        {...props}
      />
    );
  },
);

export { iconButtonVariants };
