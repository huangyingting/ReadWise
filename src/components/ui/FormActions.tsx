import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const formActionsVariants = cva(
  "flex flex-col-reverse flex-wrap items-stretch sm:flex-row sm:items-center",
  {
    variants: {
      density: {
        default: "gap-[var(--space-3)] pt-[var(--space-2)]",
        compact: "gap-[var(--space-2)] pt-[var(--space-1)]",
        reader: "gap-[var(--space-3)] pt-[var(--space-2)]",
        marketing: "gap-[var(--space-4)] pt-[var(--space-3)]",
      },
      align: {
        start: "sm:justify-start",
        end: "sm:justify-end",
        between: "sm:justify-between",
        stretch: "sm:justify-start [&>*]:sm:flex-1",
      },
    },
    defaultVariants: { density: "default", align: "end" },
  },
);

export interface FormActionsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color">,
    VariantProps<typeof formActionsVariants> {}

/**
 * Standard form action row for submit/cancel buttons.
 *
 * Keyboard/focus: preserves DOM order; the mobile `flex-col-reverse` mirrors
 * common visual order while keeping primary/secondary controls explicit in
 * markup. Buttons must remain `Button`/`IconButton` primitives.
 * Accessibility: keep destructive actions visually and textually explicit.
 *
 * @example
 * <FormActions><Button type="submit">Save</Button></FormActions>
 */
export function FormActions({
  density,
  align,
  className,
  ...props
}: FormActionsProps): React.ReactElement {
  return (
    <div
      className={cn(formActionsVariants({ density, align }), className)}
      {...props}
    />
  );
}

export { formActionsVariants };