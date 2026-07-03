"use client";

/**
 * 52-week (GitHub-style) reading activity heatmap (Issue #96).
 *
 * Receives pre-fetched HeatCell[] (server-side).
 * Renders a 7-row × 53-col CSS grid, oldest column on the left.
 * Cells are focusable list items with aria-labels for accessibility.
 * Uses CSS custom properties --heat-0..--heat-4 from tokens.css.
 */

import { useMemo, useState } from "react";
import { cn, focusRing } from "@/lib/cn";
import type { HeatCell } from "@/lib/engagement";
import { formatUTCDateLabel } from "@/lib/display-format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Abbreviated month names (Jan, Feb, …) */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Day-of-week abbreviations Sunday-first */
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEAT_LEVELS = [0, 1, 2, 3, 4] as const;
const CELL_SIZE = 12;
const CELL_GAP = 2;
const DOW_LABEL_WIDTH = 24;
const MONTH_AXIS_SPACER_WIDTH = 28;

type Column = {
  /** The 7 cells in this column (index 0 = Sunday, 6 = Saturday). */
  cells: (HeatCell | null)[];
  /** First YYYY-MM date in this column (for month label). */
  firstDate: string; // YYYY-MM-DD
};

type ActivityTotals = {
  totalActive: number;
  totalArticles: number;
};

type MonthLabel = {
  colIndex: number;
  label: string;
};

/**
 * Arrange flat cells into columns of 7 (Sun→Sat).
 * The first column may be partially filled (cells padded with null at the top).
 */
function groupIntoCols(cells: HeatCell[]): Column[] {
  if (cells.length === 0) return [];

  // Day of week of the first cell (0 = Sunday).
  const [fy, fm, fd] = cells[0].date.split("-").map(Number);
  const firstDow = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay(); // 0–6

  // Pad the beginning so column 0 starts on a Sunday.
  const padded: (HeatCell | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...cells,
  ];

  const cols: Column[] = [];
  for (let i = 0; i < padded.length; i += 7) {
    const chunk = padded.slice(i, i + 7);
    // Pad to 7 if last column is short.
    while (chunk.length < 7) chunk.push(null);
    const firstRealCell = chunk.find((c) => c !== null);
    cols.push({ cells: chunk, firstDate: firstRealCell?.date ?? "" });
  }
  return cols;
}

/** Returns the YYYY-MM of the first real cell in a column. */
function colMonth(col: Column): string {
  return col.firstDate.slice(0, 7); // "YYYY-MM"
}

function formatActivityLabel(date: string, count: number): string {
  const formattedDate = formatUTCDateLabel(date);
  return count === 0
    ? `No articles on ${formattedDate}`
    : `${count} article${count !== 1 ? "s" : ""} on ${formattedDate}`;
}

function getActivityTotals(cells: HeatCell[]): ActivityTotals {
  return cells.reduce(
    (totals, cell) => ({
      totalActive: totals.totalActive + (cell.count > 0 ? 1 : 0),
      totalArticles: totals.totalArticles + cell.count,
    }),
    { totalActive: 0, totalArticles: 0 },
  );
}

function formatActivitySummary({ totalActive, totalArticles }: ActivityTotals): string {
  if (totalActive === 0) {
    return "No reading activity in the past 52 weeks — start reading to fill this in!";
  }
  return `${totalArticles} article${totalArticles !== 1 ? "s" : ""} read on ${totalActive} day${totalActive !== 1 ? "s" : ""} in the past year`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActivityHeatmapProps {
  cells: HeatCell[];
}

export default function ActivityHeatmap({ cells }: ActivityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ date: string; count: number } | null>(null);

  const cols = useMemo(() => groupIntoCols(cells), [cells]);

  const totals = useMemo(() => getActivityTotals(cells), [cells]);

  // Build month label positions: show label when the month changes.
  const monthLabels = useMemo(() => {
    const labels: MonthLabel[] = [];
    let lastMonth = "";
    cols.forEach((col, idx) => {
      const m = colMonth(col);
      if (m && m !== lastMonth) {
        lastMonth = m;
        const [, mon] = m.split("-").map(Number);
        labels.push({ colIndex: idx, label: MONTHS[mon - 1] });
      }
    });
    return labels;
  }, [cols]);
  const monthLabelByCol = useMemo(
    () => new Map(monthLabels.map((label) => [label.colIndex, label.label])),
    [monthLabels],
  );

  return (
    <div>
      {/* Summary */}
      <p className="text-[length:var(--text-sm)] text-text-subtle mb-[var(--space-3)]">
        {formatActivitySummary(totals)}
      </p>

      {/* Grid wrapper — horizontal scroll on small screens */}
      <div
        className="overflow-x-auto pb-[var(--space-2)]"
        aria-label="52-week reading activity heatmap"
        role="img"
      >
        <div className="inline-flex flex-col gap-0 min-w-max">
          {/* Month axis */}
          <div
            className="flex mb-[var(--space-1)]"
            aria-hidden
          >
            {/* Spacer for DOW labels */}
            <div style={{ width: MONTH_AXIS_SPACER_WIDTH }} />
            {cols.map((_, idx) => {
              const monthLabel = monthLabelByCol.get(idx);
              return (
                <div
                  key={idx}
                  style={{ width: CELL_SIZE, marginRight: CELL_GAP }}
                  className="text-[length:var(--text-xs)] text-text-subtle leading-none"
                >
                  {monthLabel ?? ""}
                </div>
              );
            })}
          </div>

          {/* Grid rows (one per day-of-week) */}
          <div className="flex gap-0">
            {/* Day-of-week labels */}
            <div
              className="flex flex-col justify-between mr-[var(--space-1)]"
              style={{ width: DOW_LABEL_WIDTH }}
              aria-hidden
            >
              {DOW_LABELS.map((d, i) =>
                i % 2 === 1 ? (
                  <span
                    key={d}
                    className="text-[length:var(--text-xs)] text-text-subtle"
                    style={{
                      height: CELL_SIZE,
                      lineHeight: `${CELL_SIZE}px`,
                      marginBottom: CELL_GAP,
                    }}
                  >
                    {d.slice(0, 3)}
                  </span>
                ) : (
                  <span key={d} style={{ height: CELL_SIZE, marginBottom: CELL_GAP }} />
                ),
              )}
            </div>

            {/* Cell columns */}
            <div
              className="flex gap-[2px]"
              role="list"
            >
              {cols.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-[2px]" role="presentation">
                  {col.cells.map((cell, rowIdx) => {
                    if (!cell) {
                      return (
                        <div
                          key={rowIdx}
                          style={{ width: CELL_SIZE, height: CELL_SIZE }}
                          aria-hidden
                        />
                      );
                    }
                    const label = formatActivityLabel(cell.date, cell.count);
                    return (
                      <div
                        key={cell.date}
                        role="listitem"
                        data-level={cell.level}
                        aria-label={label}
                        tabIndex={0}
                        className={cn(
                          "rounded-[2px] transition-opacity [transition-duration:var(--duration-fast)]",
                          "hover:opacity-80 motion-reduce:transition-none",
                          focusRing,
                        )}
                        style={{
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          backgroundColor: `var(--heat-${cell.level})`,
                        }}
                        onMouseEnter={() => setTooltip({ date: cell.date, count: cell.count })}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={() => setTooltip({ date: cell.date, count: cell.count })}
                        onBlur={() => setTooltip(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip (simple fixed label, no portal needed at this size) */}
      {tooltip && (
        <p
          className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle"
          aria-live="polite"
          aria-atomic
        >
          {formatActivityLabel(tooltip.date, tooltip.count)}
        </p>
      )}

      {/* Legend */}
      <div className="flex items-center gap-[var(--space-2)] mt-[var(--space-3)]" aria-hidden>
        <span className="text-[length:var(--text-xs)] text-text-subtle">Less</span>
        {HEAT_LEVELS.map((level) => (
          <div
            key={level}
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              borderRadius: CELL_GAP,
              backgroundColor: `var(--heat-${level})`,
            }}
          />
        ))}
        <span className="text-[length:var(--text-xs)] text-text-subtle">More</span>
      </div>
    </div>
  );
}
