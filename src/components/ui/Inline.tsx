import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const inlineVariants = cva("flex", {
  variants: {
    gap: {
      "0": "gap-0",
      "1": "gap-[var(--space-1)]",
      "2": "gap-[var(--space-2)]",
      "3": "gap-[var(--space-3)]",
      "4": "gap-[var(--space-4)]",
      "5": "gap-[var(--space-5)]",
      "6": "gap-[var(--space-6)]",
      "7": "gap-[var(--space-7)]",
      "8": "gap-[var(--space-8)]",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    wrap: {
      true: "flex-wrap",
      false: "flex-nowrap",
    },
  },
  defaultVariants: {
    gap: "3",
    align: "center",
    justify: "start",
    wrap: true,
  },
});

export interface InlineProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof inlineVariants> {}

/**
 * Token-driven horizontal layout helper.
 *
 * Keyboard/focus: structural only; child controls keep native tab order.
 * Accessibility: use semantic wrappers or `aria-*` on the surrounding region
 * when the inline group needs a programmatic label.
 *
 * @example
 * <Inline justify="between"><span>Count</span><Button>Save</Button></Inline>
 */
export function Inline({
  gap,
  align,
  justify,
  wrap,
  className,
  ...props
}: InlineProps): React.ReactElement {
  return (
    <div
      className={cn(inlineVariants({ gap, align, justify, wrap }), className)}
      {...props}
    />
  );
}

export { inlineVariants };