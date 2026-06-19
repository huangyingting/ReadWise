import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const inputVariants = cva(
  cn(
    "w-full bg-surface text-text rounded-[var(--radius-md)] border",
    "px-[var(--space-3)] text-[length:var(--text-base)]",
    "placeholder:text-text-subtle",
    "transition-[border-color,box-shadow]",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "outline-none",
    "disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-not-allowed",
  ),
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
          "focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
        ),
      },
    },
    defaultVariants: { inputSize: "md", invalid: false },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ inputSize, invalid, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputVariants({ inputSize, invalid }), className)}
        {...props}
      />
    );
  },
);

export { inputVariants };
