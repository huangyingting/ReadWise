import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "@/lib/cn";

const baseInputClasses = cn(
  "w-full bg-surface text-text rounded-[var(--radius-md)] border",
  "px-[var(--space-3)] text-[length:var(--text-base)]",
  "placeholder:text-text-subtle",
  "transition-[border-color,box-shadow]",
  "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
  "outline-none",
  "disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-not-allowed",
);

const inputVariants = cva(
  baseInputClasses,
  {
    variants: {
      inputSize: {
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
          focusRing,
        ),
      },
    },
    defaultVariants: { inputSize: "md", invalid: false },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

function inputAriaInvalid(invalid: InputProps["invalid"]) {
  return invalid || undefined;
}

/**
 * Single-line text input field.
 *
 * Keyboard: native `<input>` — standard browser behavior.
 * Focus: inline focus-visible ring (token-driven, AA-compliant).
 * Accessibility: always pair with a `<Label>` via `<Field>` or explicit `htmlFor`/`id`.
 *   Sets `aria-invalid` when `invalid=true` so assistive tech announces the error state.
 *
 * Sizes: `sm` (h-8) | `md` (h-10, default).
 * Validation: `invalid` — switches border and focus ring to danger color; pair with
 *   `<Field error={msg}>` to surface the error message.
 *
 * @example
 * <Field label="Email" error={errors.email}>
 *   <Input type="email" invalid={!!errors.email} />
 * </Field>
 */

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ inputSize, invalid, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={inputAriaInvalid(invalid)}
        className={cn(inputVariants({ inputSize, invalid }), className)}
        {...props}
      />
    );
  },
);

export { inputVariants };
