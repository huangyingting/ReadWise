import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const pageShellVariants = cva("mx-auto w-full", {
  variants: {
    variant: {
      listing: "max-w-[var(--container-listing)]",
      narrow: "max-w-[var(--container-narrow)]",
      reading: "max-w-[var(--container-reading)]",
      marketing: "max-w-[var(--marketing-container-w)]",
      full: "max-w-none",
    },
    density: {
      default: "px-[var(--space-5)] py-[var(--space-7)]",
      compact: "px-[var(--space-4)] py-[var(--space-5)]",
      reader: "px-[var(--space-4)] py-[var(--space-6)]",
      marketing:
        "px-[var(--space-5)] py-[var(--space-10)] sm:py-[var(--space-12)]",
    },
  },
  defaultVariants: { variant: "listing", density: "default" },
});

export interface PageShellProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof pageShellVariants> {
  /** Semantic element to render. Defaults to `div` for backwards compatibility. */
  as?: "div" | "main" | "section";
}

/**
 * Standard centered page container.
 *
 * Keyboard/focus: purely structural; it does not add focusable elements or
 * change tab order. Child interactive controls keep their own native focus
 * behavior.
 * Accessibility: preserve a single page-level heading inside the shell.
 *
 * @example
 * <PageShell variant="narrow">
 *   <PageHeader title="Settings" />
 * </PageShell>
 */
export function PageShell({
  as: Component = "div",
  variant,
  density,
  className,
  ...props
}: PageShellProps): React.ReactElement {
  return (
    <Component
      className={cn(pageShellVariants({ variant, density }), className)}
      {...props}
    />
  );
}

export { pageShellVariants };