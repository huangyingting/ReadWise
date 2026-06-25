import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "@/lib/cn";
import { Spinner } from "./Spinner";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-[var(--space-2)] whitespace-nowrap font-semibold",
    "rounded-[var(--radius-md)] select-none",
    "transition-[background-color,border-color,box-shadow,transform]",
    "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    "active:translate-y-px",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-on-primary shadow-[var(--shadow-sm)] hover:bg-primary-hover active:shadow-none",
        secondary:
          "bg-surface text-text border border-border-strong shadow-[var(--shadow-sm)] hover:bg-bg-subtle",
        ghost: "bg-transparent text-text hover:bg-bg-subtle",
        danger:
          "bg-danger text-on-danger shadow-[var(--shadow-sm)] hover:bg-danger-hover active:shadow-none",
        "danger-ghost":
          "bg-transparent text-[var(--danger-text)] border border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] active:shadow-none",
        outline:
          "bg-transparent text-text border border-border-strong hover:bg-bg-subtle",
      },
      size: {
        sm: "h-8 px-[var(--space-3)] text-[length:var(--text-sm)]",
        md: "h-10 px-[var(--space-4)] text-[length:var(--text-base)]",
        lg: "h-12 px-[var(--space-5)] text-[length:var(--text-lg)]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Show a leading spinner, dim the label, and disable interaction. */
  loading?: boolean;
  /** Optional leading icon (hidden while loading). */
  leadingIcon?: React.ReactNode;
  /** Optional trailing icon. */
  trailingIcon?: React.ReactNode;
}

/**
 * General-purpose action button.
 *
 * Keyboard: native `<button>` — Space and Enter activate.
 * Focus: embeds `focusRing` (outline-none + focus-visible box-shadow ring).
 * Accessibility: pass `aria-label` when the visible label is icon-only.
 * Loading state: sets `aria-busy` and `disabled`; prevents double-submission.
 *
 * Variants: `primary` | `secondary` | `ghost` | `danger` | `danger-ghost` | `outline`.
 * Sizes: `sm` (h-8) | `md` (h-10, default) | `lg` (h-12).
 *
 * @example
 * <Button variant="secondary" size="sm" onClick={handler}>Save</Button>
 */

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      loading = false,
      leadingIcon,
      trailingIcon,
      disabled,
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? (
          <Spinner size={16} />
        ) : (
          leadingIcon && <span className="inline-flex shrink-0">{leadingIcon}</span>
        )}
        <span className={cn(loading && "opacity-70")}>{children}</span>
        {trailingIcon && !loading && (
          <span className="inline-flex shrink-0">{trailingIcon}</span>
        )}
      </button>
    );
  },
);

export { buttonVariants };
