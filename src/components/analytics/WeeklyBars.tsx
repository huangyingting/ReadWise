/**
 * WeeklyBars — 12-week bar chart widget used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access.
 */

import { AccessibleDataTable } from "@/components/admin/AccessibleDataTable";

export interface WeekBucket {
  week: string;
  count: number;
}

export interface WeeklyBarsProps {
  buckets: WeekBucket[];
  label: string;
  color?: string;
}

const CHART_HEIGHT = 64;
const GHOST_BAR_OPACITY = 0.12;
const MIN_FILLED_BAR_HEIGHT = 4;
const BASELINE_OFFSET = 8;

function shortWeekLabel(week: string): string {
  return week.replace(/^\d{4}-/, "");
}

function getBarHeight(count: number, max: number): number {
  if (count <= 0) return CHART_HEIGHT;
  return Math.max(
    Math.round((count / max) * (CHART_HEIGHT - BASELINE_OFFSET)),
    MIN_FILLED_BAR_HEIGHT,
  );
}

function getMaxCount(buckets: WeekBucket[]): number {
  return Math.max(...buckets.map((bucket) => bucket.count), 1);
}

export function WeeklyBars({
  buckets,
  label,
  color = "var(--teal)",
}: WeeklyBarsProps) {
  const max = getMaxCount(buckets);
  const firstWeek = buckets[0]?.week;
  const lastWeek = buckets[buckets.length - 1]?.week;

  return (
    <figure aria-label={label}>
      <figcaption className="sr-only">{label}</figcaption>

      {/* Bar chart — baseline rendered via border-b */}
      <div
        className="flex items-end gap-[var(--space-1)] border-b border-border"
        style={{ height: CHART_HEIGHT }}
      >
        {buckets.map((bucket) => {
          const hasCount = bucket.count > 0;
          const weekLabel = `Week of ${shortWeekLabel(bucket.week)}: ${bucket.count}`;

          return (
            <div
              key={bucket.week}
              className="flex-1 rounded-t-sm transition-all"
              style={{
                height: getBarHeight(bucket.count, max),
                backgroundColor: hasCount ? color : "var(--border)",
                opacity: hasCount ? 1 : GHOST_BAR_OPACITY,
              }}
              role="img"
              aria-label={weekLabel}
              title={`${bucket.week}: ${bucket.count}`}
            />
          );
        })}
      </div>

      {/* Week axis labels — first and last only */}
      <div className="flex justify-between mt-1">
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {firstWeek ? shortWeekLabel(firstWeek) : undefined}
        </span>
        <span className="text-[length:var(--text-xs)] text-text-subtle">
          {lastWeek ? shortWeekLabel(lastWeek) : undefined}
        </span>
      </div>

      <AccessibleDataTable
        caption={label}
        columns={[
          { key: "week", label: "Week" },
          { key: "count", label: "Count" },
        ]}
        rows={buckets.map((bucket) => ({
          week: bucket.week,
          count: bucket.count,
        }))}
      />
    </figure>
  );
}
