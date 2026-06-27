import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const pageHeaderVariants = cva("", {
  variants: {
    density: {
      default: "mb-[var(--space-6)]",
      compact: "mb-[var(--space-4)]",
      reader: "mb-[var(--space-5)]",
      marketing: "mb-[var(--space-8)]",
    },
    align: {
      start: "text-left",
      center: "text-center",
    },
  },
  defaultVariants: { density: "default", align: "start" },
});

const titleVariants = cva(
  cn(
    "m-0 font-[family-name:var(--font-display)] font-semibold text-text",
    "leading-[var(--leading-tight)]",
  ),
  {
    variants: {
      density: {
        default: "text-[length:var(--text-3xl)]",
        compact: "text-[length:var(--text-2xl)]",
        reader: "text-[length:var(--text-2xl)]",
        marketing: "text-[length:var(--text-4xl)]",
      },
    },
    defaultVariants: { density: "default" },
  },
);

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title">,
    VariantProps<typeof pageHeaderVariants> {
  /** Page title rendered as the main heading by default. */
  title: React.ReactNode;
  /** Optional supporting description rendered beneath the title. */
  description?: React.ReactNode;
  /** Optional eyebrow/kicker content rendered above the title. */
  eyebrow?: React.ReactNode;
  /** Optional actions aligned opposite the title on wide screens. */
  actions?: React.ReactNode;
  /** Heading level to render. Defaults to `h1`. */
  level?: "h1" | "h2" | "h3";
}

/**
 * Standard page heading block with title, optional description, and actions.
 *
 * Keyboard/focus: purely structural; action controls retain their own focus
 * contracts and remain after the heading in DOM order.
 * Accessibility: defaults to an `h1`; use `level` only when nesting inside an
 * existing page heading hierarchy.
 *
 * @example
 * <PageHeader title="Dashboard" actions={<Button>Import</Button>} />
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  level: Heading = "h1",
  density,
  align = "start",
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  return (
    <header
      className={cn(pageHeaderVariants({ density, align }), className)}
      {...props}
    >
      {eyebrow ? (
        <p className="mb-[var(--space-2)] text-[length:var(--text-sm)] font-semibold uppercase tracking-[0.08em] text-primary-text">
          {eyebrow}
        </p>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-[var(--space-4)] sm:flex-row",
          align === "center"
            ? "items-center justify-center"
            : "items-start justify-between",
        )}
      >
        <div className={cn("min-w-0", align === "center" && "mx-auto")}>
          <Heading className={titleVariants({ density })}>{title}</Heading>
          {description ? (
            <p
              className={cn(
                "mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-base)] leading-[var(--leading-normal)] text-text-muted",
                align === "center" && "mx-auto",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

export { pageHeaderVariants, titleVariants as pageHeaderTitleVariants };