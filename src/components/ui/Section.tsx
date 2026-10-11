import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const sectionVariants = cva("w-full", {
  variants: {
    surface: {
      plain: "",
      card:
        "rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-surface)]",
      subtle: "rounded-[var(--radius-lg)] bg-bg-subtle",
    },
    density: {
      default: "",
      compact: "text-[length:var(--type-ui)]",
      reader: "",
      marketing: "",
    },
  },
  compoundVariants: [
    {
      surface: ["card", "subtle"],
      density: "default",
      className: "p-[var(--surface-pad-compact)] sm:p-[var(--surface-pad)]",
    },
    {
      surface: ["card", "subtle"],
      density: "compact",
      className: "p-[var(--surface-pad-compact)]",
    },
    {
      surface: ["card", "subtle"],
      density: "reader",
      className: "p-[var(--surface-pad)]",
    },
    {
      surface: ["card", "subtle"],
      density: "marketing",
      className: "p-[var(--space-6)] sm:p-[var(--space-8)]",
    },
  ],
  defaultVariants: { surface: "plain", density: "default" },
});

const sectionHeaderClasses =
  "mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center sm:justify-between";

const sectionTitleBaseClasses =
  "m-0 font-[family-name:var(--font-display)] font-semibold leading-[var(--leading-snug)] text-text";

function sectionTitleClasses(density: SectionProps["density"]) {
  return cn(
    sectionTitleBaseClasses,
    density === "compact"
      ? "text-[length:var(--type-section-title-compact)]"
      : "text-[length:var(--type-section-title)]",
  );
}

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
  const hasHeader = title || description || actions;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(sectionVariants({ surface, density }), className)}
      {...props}
    >
      {hasHeader ? (
        <SectionHeader
          title={title}
          description={description}
          actions={actions}
          Title={Title}
          headingId={headingId}
          density={density}
        />
      ) : null}
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  description,
  actions,
  Title,
  headingId,
  density,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  actions: React.ReactNode;
  Title: NonNullable<SectionProps["titleAs"]>;
  headingId?: string;
  density: SectionProps["density"];
}) {
  return (
    <div className={sectionHeaderClasses}>
      <div className="min-w-0">
        {title ? (
          <Title id={headingId} className={sectionTitleClasses(density)}>
            {title}
          </Title>
        ) : null}
        {description ? (
          <p className="mt-[var(--space-1)] max-w-[70ch] text-[length:var(--type-ui)] leading-[var(--leading-normal)] text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export { sectionVariants };