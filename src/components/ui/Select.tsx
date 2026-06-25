import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const selectVariants = cva(
  cn(
    "w-full appearance-none bg-surface text-text rounded-[var(--radius-md)] border cursor-pointer",
    "pl-[var(--space-3)] pr-[var(--space-8)] text-[length:var(--text-base)]",
    "transition-[border-color,box-shadow]",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "outline-none",
    "disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-not-allowed",
  ),
  {
    variants: {
      selectSize: {
        sm: "h-8",
        md: "h-10",
      },
      invalid: {
        true: cn(
          "border-danger",
          "focus-visible:border-danger",
          "focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--danger)]",
        ),
        false: cn(
          "border-border-strong hover:border-text-subtle",
          "focus-visible:border-primary",
          "focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
        ),
      },
    },
    defaultVariants: { selectSize: "md", invalid: false },
  },
);

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">,
    VariantProps<typeof selectVariants> {}

/**
 * Native `<select>` wrapper with a ChevronDown decorative icon.
 *
 * Keyboard: native browser select behavior (Arrow keys open/navigate the option list).
 * Focus: inline focus-visible ring (token-driven, AA-compliant).
 * Accessibility: always pair with a `<Label>` via `<Field>` or explicit `htmlFor`/`id`.
 *   Sets `aria-invalid` when `invalid=true`. The ChevronDown icon is `aria-hidden`.
 *
 * Sizes: `sm` (h-8) | `md` (h-10, default).
 * Validation: `invalid` — switches border and focus ring to danger color.
 *
 * @example
 * <Field label="Language">
 *   <Select>
 *     <option value="en">English</option>
 *     <option value="zh">Chinese</option>
 *   </Select>
 * </Field>
 */

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ selectSize, invalid, className, children, ...props }, ref) {
    return (
      <div className="relative inline-flex w-full items-center">
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(selectVariants({ selectSize, invalid }), className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          size={16}
          className="pointer-events-none absolute right-[var(--space-3)] text-text-subtle"
        />
      </div>
    );
  },
);

export { selectVariants };
