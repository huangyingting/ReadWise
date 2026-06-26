import { Card } from "@/components/ui/Card";
import { AccessibleDataTable } from "./AccessibleDataTable";

export interface BarChartBucket {
  key: string;
  label: string;
  count: number;
}

/**
 * A single bar row for use inside a ratio/percentage chart card.
 * Renders a label, a meter track, and an optional custom value string.
 * Intended for inline use alongside `BarChart` when the value is a ratio
 * rather than a raw count (e.g. "72% (144/200)").
 */
export function BarChartRow({
  label,
  valuenow,
  valuemax = 100,
  renderValue,
}: {
  label: string;
  /** The numeric value that determines bar fill (0–valuemax). */
  valuenow: number;
  /** The scale maximum. Defaults to 100. */
  valuemax?: number;
  /** Custom value string shown in the value cell. Defaults to `valuenow`. */
  renderValue?: React.ReactNode;
}) {
  const pct = valuemax > 0 ? (valuenow / valuemax) * 100 : 0;
  return (
    <div className="admin-bar-row">
      <span className="admin-bar-label">{label}</span>
      <span
        role="meter"
        aria-label={`${label}: ${valuenow}`}
        aria-valuenow={valuenow}
        aria-valuemin={0}
        aria-valuemax={valuemax}
        className="admin-bar-track"
      >
        <span className="admin-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <strong className="admin-bar-value" aria-hidden="true">
        {renderValue ?? valuenow}
      </strong>
    </div>
  );
}

/**
 * SSR-friendly CSS bar chart for admin analytics.
 *
 * Accessibility:
 *  - Wrapped in a `<figure>` with `aria-label` (the chart title).
 *  - Each bar row carries `role="meter"` with min/max/valuenow.
 *  - A visually-hidden `<table>` provides a data fallback for
 *    screen readers and text browsers via `AccessibleDataTable`.
 *
 * Styling: reuses the `.admin-bar-*` tokens from globals.css.
 */
export function BarChart({
  title,
  buckets,
}: {
  title: string;
  buckets: BarChartBucket[];
}) {
  if (buckets.length === 0) {
    return <p className="muted">No data yet.</p>;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <figure aria-label={title} className="m-0">
      <Card>
        <div className="stack">
          {buckets.map((b) => (
            <BarChartRow
              key={b.key}
              label={b.label}
              valuenow={b.count}
              valuemax={max}
            />
          ))}
        </div>
      </Card>

      <AccessibleDataTable
        caption={title}
        columns={[
          { key: "label", label: "Category" },
          { key: "count", label: "Count" },
        ]}
        rows={buckets.map((b) => ({ label: b.label, count: b.count }))}
      />
    </figure>
  );
}
