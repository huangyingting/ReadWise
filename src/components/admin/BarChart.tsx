import { Card } from "@/components/ui/Card";

export interface BarChartBucket {
  key: string;
  label: string;
  count: number;
}

/**
 * SSR-friendly CSS bar chart for admin analytics.
 *
 * Accessibility:
 *  - Wrapped in a `<figure>` with `aria-label` (the chart title).
 *  - Each bar row carries `role="meter"` with min/max/valuenow.
 *  - A visually-hidden `<table>` provides a data fallback for
 *    screen readers and text browsers.
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
            <div key={b.key} className="admin-bar-row">
              <span className="admin-bar-label">{b.label}</span>
              <span
                role="meter"
                aria-label={`${b.label}: ${b.count}`}
                aria-valuenow={b.count}
                aria-valuemin={0}
                aria-valuemax={max}
                className="admin-bar-track"
              >
                <span
                  className="admin-bar-fill"
                  style={{ width: `${(b.count / max) * 100}%` }}
                />
              </span>
              <strong className="admin-bar-value" aria-hidden="true">
                {b.count}
              </strong>
            </div>
          ))}
        </div>
      </Card>

      {/* Visually-hidden data table for screen readers */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.key}>
              <td>{b.label}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
