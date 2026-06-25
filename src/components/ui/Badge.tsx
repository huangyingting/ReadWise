import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { CEFR_LEVELS, type CefrLevel } from "@/lib/option-registries";

export { CEFR_LEVELS, type CefrLevel };

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
const CEFR_CLASSES: Record<CefrLevel, string> = {
  A1: "bg-[var(--cefr-a1-bg)] text-[var(--cefr-a1-text)]",
  A2: "bg-[var(--cefr-a2-bg)] text-[var(--cefr-a2-text)]",
  B1: "bg-[var(--cefr-b1-bg)] text-[var(--cefr-b1-text)]",
  B2: "bg-[var(--cefr-b2-bg)] text-[var(--cefr-b2-text)]",
  C1: "bg-[var(--cefr-c1-bg)] text-[var(--cefr-c1-text)]",
  C2: "bg-[var(--cefr-c2-bg)] text-[var(--cefr-c2-text)]",
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
