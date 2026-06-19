import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeBase = cn(
  "inline-flex items-center justify-center gap-[var(--space-1)]",
  "rounded-[var(--radius-full)] font-semibold whitespace-nowrap",
  "px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)]",
);

const badgeVariants = cva(badgeBase, {
  variants: {
    variant: {
      neutral: "bg-bg-subtle text-text-muted border border-border",
      primary:
        "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-text border border-[color-mix(in_srgb,var(--primary)_30%,transparent)]",
      success:
        "bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success-text border border-[color-mix(in_srgb,var(--success)_32%,transparent)]",
      warning:
        "bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-warning-text border border-[color-mix(in_srgb,var(--warning)_34%,transparent)]",
      danger:
        "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger-text border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]",
    },
    uppercase: {
      true: "uppercase tracking-wide",
      false: "",
    },
  },
  defaultVariants: { variant: "neutral", uppercase: false },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({
  variant,
  uppercase,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, uppercase }), className)}
      {...props}
    />
  );
}

/** CEFR difficulty levels with verified-AA light/dark colour pairs (Saul §8). */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

const CEFR_CLASSES: Record<CefrLevel, string> = {
  A1: "bg-[#ecfdf5] text-[#047857] dark:bg-[#053b2c] dark:text-[#34d399]",
  A2: "bg-[#f0fdf4] text-[#15803d] dark:bg-[#0a3a1f] dark:text-[#4ade80]",
  B1: "bg-[#eff6ff] text-[#0369a1] dark:bg-[#0a2e44] dark:text-[#38bdf8]",
  B2: "bg-[#eef2ff] text-[#4338ca] dark:bg-[#1e1b4b] dark:text-[#a5b4fc]",
  C1: "bg-[#fffbeb] text-[#b45309] dark:bg-[#3a2606] dark:text-[#fbbf24]",
  C2: "bg-[#fff1f2] text-[#be123c] dark:bg-[#3f1018] dark:text-[#fb7185]",
};

export interface CefrBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  level: CefrLevel;
}

export function CefrBadge({ level, className, ...props }: CefrBadgeProps) {
  return (
    <span
      className={cn(badgeBase, "border border-transparent", CEFR_CLASSES[level], className)}
      {...props}
    >
      {level}
    </span>
  );
}

export interface CategoryBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** Selected/active state uses the brand primary tint. */
  active?: boolean;
}

/** Category/topic pill: neutral by default, brand-tinted when active/selected. */
export function CategoryBadge({
  active,
  className,
  ...props
}: CategoryBadgeProps) {
  return (
    <span
      className={cn(
        badgeBase,
        active
          ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-text border border-primary"
          : "bg-bg-subtle text-text-muted border border-border",
        className,
      )}
      {...props}
    />
  );
}

export { badgeVariants };
