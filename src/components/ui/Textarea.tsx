import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const textareaVariants = cva(
  cn(
    "w-full bg-surface text-text rounded-[var(--radius-md)] border",
    "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-base)]",
    "placeholder:text-text-subtle",
    "transition-[border-color,box-shadow]",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "outline-none resize-none",
    "disabled:bg-bg-subtle disabled:opacity-60 disabled:cursor-not-allowed",
  ),
  {
    variants: {
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
    defaultVariants: { invalid: false },
  },
);

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size">,
    VariantProps<typeof textareaVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(textareaVariants({ invalid }), className)}
        {...props}
      />
    );
  },
);

export { textareaVariants };
