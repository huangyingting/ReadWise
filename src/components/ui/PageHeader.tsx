import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const pageHeaderVariants = cva("", {
  variants: {
    density: {
      default: "mb-[var(--space-5)]",
      compact: "mb-[var(--space-4)]",
      reader: "mb-[var(--space-4)]",
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
    "leading-[var(--leading-snug)] tracking-[-0.01em]",
  ),
  {
    variants: {
      density: {
        default: "text-[length:var(--type-page-title)]",
        compact: "text-[length:var(--type-page-title-compact)]",
        reader: "text-[length:var(--type-page-title)]",
        marketing: "text-[length:var(--text-4xl)]",
      },
    },
    defaultVariants: { density: "default" },
  },
);

const descriptionVariants = cva(
  "mt-[var(--space-1)] max-w-[70ch] leading-[var(--leading-normal)] text-text-muted",
  {
    variants: {
      density: {
        default: "text-[length:var(--type-ui)]",
        compact: "text-[length:var(--type-ui)]",
        reader: "text-[length:var(--type-ui)]",
        marketing: "text-[length:var(--text-base)]",
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

type HeadingTag = NonNullable<PageHeaderProps["level"]>;

function getHeaderBodyClass(align: PageHeaderProps["align"]): string {
  return align === "center"
    ? "items-center justify-center"
    : "items-start justify-between sm:items-center";
}

function getCenteredClass(align: PageHeaderProps["align"]): string | false {
  return align === "center" && "mx-auto";
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
  level = "h1",
  density,
  align = "start",
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  const Heading = level as HeadingTag;

  return (
    <header
      className={cn(pageHeaderVariants({ density, align }), className)}
      {...props}
    >
      {eyebrow ? (
        <div
          className={cn(
            "mb-[var(--space-1)] text-[length:var(--type-label)] font-semibold uppercase tracking-[var(--tracking-label)] text-primary-text",
            align === "center" && "mx-auto w-fit",
          )}
        >
          {eyebrow}
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-[var(--space-3)] sm:flex-row",
          getHeaderBodyClass(align),
        )}
      >
        <div className={cn("min-w-0", getCenteredClass(align))}>
          <Heading className={titleVariants({ density })}>{title}</Heading>
          {description ? (
            <p
              className={cn(
                descriptionVariants({ density }),
                getCenteredClass(align),
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
