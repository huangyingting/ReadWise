/**
 * WeeklyBars — 12-week bar chart widget used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access.
 */

export interface WeekBucket {
  week: string;
  count: number;
}

export interface WeeklyBarsProps {
  buckets: WeekBucket[];
  label: string;
  color?: string;
}

export function WeeklyBars({
  buckets,
  label,
  color = "var(--teal)",
}: WeeklyBarsProps) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const CHART_H = 64;
  return (
    <figure aria-label={label}>
      <figcaption className="sr-only">{label}</figcaption>

      {/* Bar chart — baseline rendered via border-b */}
      <div
        className="flex items-end gap-[var(--space-1)] border-b border-border"
        style={{ height: CHART_H }}
      >
        {buckets.map((b) => {
          const barH =
            b.count > 0
              ? Math.max(Math.round((b.count / max) * (CHART_H - 8)), 4)
              : CHART_H; // ghost bar: full height, very faint
          const weekLabel = `Week of ${b.week.replace(/^\d{4}-/, "")}: ${b.count}`;
          return (
            <div
              key={b.week}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: barH,
                backgroundColor: b.count > 0 ? color : "var(--border)",
                opacity: b.count > 0 ? 1 : 0.12,
              }}
              role="img"
              aria-label={weekLabel}
              title={`${b.week}: ${b.count}`}
            />
          );
        })}
      </div>

      {/* Week axis labels — first and last only */}
      <div className="flex justify-between mt-1">
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {buckets[0]?.week.replace(/^\d{4}-/, "")}
        </span>
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {buckets[buckets.length - 1]?.week.replace(/^\d{4}-/, "")}
        </span>
      </div>

      {/* Visually-hidden data table for screen readers */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.week}>
              <td>{b.week}</td>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
