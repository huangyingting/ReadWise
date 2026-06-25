/**
 * MiniBar — horizontal progress bar widget used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access.
 */

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
  return (
    <div className="flex items-center gap-[var(--space-2)]" title={label}>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 8, backgroundColor: "var(--border)" }}
        role="presentation"
      >
        <div
          style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 9999 }}
        />
      </div>
      <span
        className="text-[length:var(--text-xs)] text-text-subtle tabular-nums"
        style={{ minWidth: "2ch", textAlign: "right" }}
        aria-label={`${value} ${label}`}
      >
        {value}
      </span>
    </div>
  );
}
