import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const metricStripVariants = cva(
  cn(
    "m-0 grid w-full overflow-hidden rounded-[var(--radius-lg)] bg-surface",
    "shadow-[var(--shadow-surface)]",
  ),
  {
    variants: {
      columns: {
        2: "grid-cols-2",
        3: "grid-cols-2 sm:grid-cols-3",
        4: "grid-cols-2 sm:grid-cols-4",
        6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
      },
    },
    defaultVariants: { columns: 4 },
  },
);

/* Right + bottom hairlines on every cell; the strip's overflow clip hides the
 * ones on the outer edge, so only interior dividers remain at any column count. */
const METRIC_CELL_CLASS = cn(
  "flex min-w-0 flex-col gap-[var(--space-1)] px-[var(--space-4)] py-[var(--space-3)]",
  "shadow-[1px_0_0_var(--divider),0_1px_0_var(--divider)]",
);

const metricValueVariants = cva(
  cn(
    "m-0 truncate font-[family-name:var(--font-display)] font-semibold",
    "text-[length:var(--type-metric-compact)] leading-[var(--leading-snug)] tabular-nums",
  ),
  {
    variants: {
      tone: {
        default: "text-text",
        success: "text-success-text",
        warning: "text-warning-text",
        danger: "text-danger-text",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export interface MetricStripProps
  extends React.HTMLAttributes<HTMLDListElement>,
    VariantProps<typeof metricStripVariants> {}

/**
 * Borderless KPI strip: one surface split into metric cells by hairline
 * dividers. Use for summary numbers at the top of dashboards and admin pages
 * instead of a grid of separate cards.
 *
 * Keyboard/focus: structural only; contains no focusable elements.
 * Accessibility: renders a `<dl>`; each `Metric` is a `<div>` grouping its
 * `<dt>` label and `<dd>` value. Add `aria-label` when no heading names it.
 *
 * @example
 * <MetricStrip columns={4} aria-label="Job totals">
 *   <Metric label="Pending" value={12} />
 *   <Metric label="Failed" value={2} tone="danger" />
 * </MetricStrip>
 */
export function MetricStrip({
  columns,
  className,
  ...props
}: MetricStripProps): React.ReactElement {
  return (
    <dl className={cn(metricStripVariants({ columns }), className)} {...props} />
  );
}

export interface MetricProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
    VariantProps<typeof metricValueVariants> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Optional supporting caption under the value. */
  sub?: React.ReactNode;
}

/** A single metric cell inside `MetricStrip`. */
export function Metric({
  label,
  value,
  sub,
  tone,
  className,
  ...props
}: MetricProps): React.ReactElement {
  return (
    <div className={cn(METRIC_CELL_CLASS, className)} {...props}>
      <dt className="truncate text-[length:var(--type-label)] font-semibold uppercase tracking-[var(--tracking-label)] text-text-subtle">
        {label}
      </dt>
      <dd className={metricValueVariants({ tone })}>{value}</dd>
      {sub ? (
        <dd className="m-0 text-[length:var(--type-label)] text-text-subtle">
          {sub}
        </dd>
      ) : null}
    </div>
  );
}

export { metricStripVariants };
