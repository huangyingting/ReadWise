/**
 * MiniBar — horizontal progress bar widget used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access.
 */

import { Tooltip } from "@/components/ui";

export interface MiniBarProps {
  value: number;
  max: number;
  label: string;
  color?: string;
}

export function MiniBar({
  value,
  max,
  label,
  color = "var(--teal)",
}: MiniBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const valueLabel = `${value} ${label}`;

  return (
    <Tooltip content={label} className="w-full">
      <div className="flex w-full items-center gap-[var(--space-2)]">
        <div
          className="flex-1 rounded-full overflow-hidden"
          style={{ height: 8, backgroundColor: "var(--border)" }}
          role="presentation"
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              backgroundColor: color,
              borderRadius: 9999,
            }}
          />
        </div>
        <span
          className="text-[length:var(--text-xs)] text-text-subtle tabular-nums"
          style={{ minWidth: "2ch", textAlign: "right" }}
          aria-label={valueLabel}
        >
          {value}
        </span>
      </div>
    </Tooltip>
  );
}
