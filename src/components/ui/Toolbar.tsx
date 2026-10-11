import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const toolbarVariants = cva("flex w-full flex-wrap", {
  variants: {
    density: {
      default: "gap-[var(--space-3)]",
      compact: "gap-[var(--space-2)] text-[length:var(--type-ui)]",
      reader: "gap-[var(--space-2)]",
      marketing: "gap-[var(--space-4)]",
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
    surface: {
      plain: "",
      subtle:
        "rounded-[var(--radius-md)] bg-bg-subtle p-[var(--space-2)]",
      card:
        "rounded-[var(--radius-lg)] bg-surface p-[var(--space-2)] shadow-[var(--shadow-surface)]",
    },
  },
  defaultVariants: {
    density: "default",
    align: "center",
    justify: "between",
    surface: "plain",
  },
});

type ToolbarVariantProps = VariantProps<typeof toolbarVariants>;
type ToolbarElementProps = Omit<React.HTMLAttributes<HTMLDivElement>, "color">;

export interface ToolbarProps
  extends ToolbarElementProps,
    ToolbarVariantProps {}

function getToolbarClassName({
  density,
  align,
  justify,
  surface,
  className,
}: ToolbarVariantProps & { className?: string }) {
  return cn(toolbarVariants({ density, align, justify, surface }), className);
}

/**
 * Standard action/filter row.
 *
 * Keyboard/focus: does not implement roving tabindex; children remain in
 * natural DOM order. If you pass `role="toolbar"`, provide an `aria-label` and
 * keep child controls keyboard-operable with their primitives.
 * Accessibility: use for related actions or filters; do not reorder controls
 * visually in a way that differs from DOM order.
 *
 * @example
 * <Toolbar aria-label="Saved words actions"><Button>Export</Button></Toolbar>
 */
export function Toolbar({
  density,
  align,
  justify,
  surface,
  className,
  ...props
}: ToolbarProps): React.ReactElement {
  return (
    <div
      className={getToolbarClassName({ density, align, justify, surface, className })}
      {...props}
    />
  );
}

export { toolbarVariants };