import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const sectionVariants = cva("w-full", {
  variants: {
    surface: {
      plain: "",
      card:
        "rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-sm)]",
      subtle: "rounded-[var(--radius-lg)] border border-border bg-bg-subtle",
    },
    density: {
      default: "",
      compact: "text-[length:var(--text-sm)]",
      reader: "",
      marketing: "",
    },
  },
  compoundVariants: [
    {
      surface: ["card", "subtle"],
      density: "default",
      className: "p-[var(--space-5)] sm:p-[var(--space-6)]",
    },
    {
      surface: ["card", "subtle"],
      density: "compact",
      className: "p-[var(--space-4)]",
    },
    {
      surface: ["card", "subtle"],
      density: "reader",
      className: "p-[var(--space-5)]",
    },
    {
      surface: ["card", "subtle"],
      density: "marketing",
      className: "p-[var(--space-6)] sm:p-[var(--space-8)]",
    },
  ],
  defaultVariants: { surface: "plain", density: "default" },
});

export interface SectionProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title">,
    VariantProps<typeof sectionVariants> {
  /** Optional section heading. */
  title?: React.ReactNode;
  /** Optional supporting copy below the title. */
  description?: React.ReactNode;
  /** Optional actions aligned opposite the title. */
  actions?: React.ReactNode;
  /** Heading level to render when `title` is provided. Defaults to `h2`. */
  titleAs?: "h2" | "h3" | "h4";
}

/**
 * Standard page section wrapper with optional heading and actions.
 *
 * Keyboard/focus: structural only; actions remain after the heading in DOM
 * order and keep their primitive focus rings.
 * Accessibility: when `title` is supplied, the section is labelled by that
 * heading through `aria-labelledby`.
 *
 * @example
 * <Section title="Saved words" actions={<Button>Export</Button>}>
 *   <StudyList />
 * </Section>
 */
export function Section({
  title,
  description,
  actions,
  titleAs: Title = "h2",
  surface,
  density,
  className,
  children,
  ...props
}: SectionProps): React.ReactElement {
  const reactId = React.useId();
  const headingId = title ? `${reactId}-section-title` : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(sectionVariants({ surface, density }), className)}
      {...props}
    >
      {title || description || actions ? (
        <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? (
              <Title
                id={headingId}
                className={cn(
                  "m-0 font-[family-name:var(--font-display)] font-semibold leading-[var(--leading-snug)] text-text",
                  density === "compact"
                    ? "text-[length:var(--text-lg)]"
                    : "text-[length:var(--text-2xl)]",
                )}
              >
                {title}
              </Title>
            ) : null}
            {description ? (
              <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export { sectionVariants };