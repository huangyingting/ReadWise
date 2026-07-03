import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const TABLE_SURFACE_BASE_CLASS = cn(
  "w-full overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface",
  "shadow-[var(--shadow-sm)]",
);

const tableSurfaceVariants = cva(
  TABLE_SURFACE_BASE_CLASS,
  {
    variants: {
      density: {
        default: "text-[length:var(--text-sm)]",
        compact: "text-[length:var(--text-xs)]",
        reader: "text-[length:var(--text-sm)]",
        marketing: "text-[length:var(--text-base)]",
      },
    },
    defaultVariants: { density: "default" },
  },
);

export interface TableSurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tableSurfaceVariants> {}

/**
 * Token-driven scroll container for data tables.
 *
 * Keyboard/focus: structural only; native table and child controls keep their
 * normal focus behavior. Horizontal overflow remains keyboard reachable through
 * browser defaults when the table contains focusable cells/controls.
 * Accessibility: keep the semantic `<table>` inside this surface and provide a
 * table `<caption>` when the surrounding heading does not label it.
 *
 * @example
 * <TableSurface density="compact"><table>...</table></TableSurface>
 */
export function TableSurface({
  density,
  className,
  ...props
}: TableSurfaceProps): React.ReactElement {
  return (
    <div
      className={cn(tableSurfaceVariants({ density }), className)}
      {...props}
    />
  );
}

export { tableSurfaceVariants };