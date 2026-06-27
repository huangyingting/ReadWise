import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const stackVariants = cva("flex flex-col", {
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
      "9": "gap-[var(--space-9)]",
      "10": "gap-[var(--space-10)]",
      "11": "gap-[var(--space-11)]",
      "12": "gap-[var(--space-12)]",
    },
    align: {
      stretch: "items-stretch",
      start: "items-start",
      center: "items-center",
      end: "items-end",
    },
  },
  defaultVariants: { gap: "4", align: "stretch" },
});

export interface StackProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof stackVariants> {}

/**
 * Token-driven vertical layout helper.
 *
 * Keyboard/focus: structural only; it never inserts focusable elements or
 * changes child order.
 * Accessibility: prefer semantic containers (`section`, `nav`, etc.) around
 * Stack when the region needs a landmark.
 *
 * @example
 * <Stack gap="5"><Card /> <Card /></Stack>
 */
export function Stack({
  gap,
  align,
  className,
  ...props
}: StackProps): React.ReactElement {
  return (
    <div className={cn(stackVariants({ gap, align }), className)} {...props} />
  );
}

export { stackVariants };