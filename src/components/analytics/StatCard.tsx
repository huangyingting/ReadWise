/**
 * StatCard — metric summary card used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access. Use it when a metric carries an icon identity (learner
 * progress). For plain label/value summary rows prefer `MetricStrip`.
 */
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export interface StatCardProps {
  /** Optional Lucide icon rendered in a tinted chip. */
  icon?: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  /**
   * Chip and icon tint color. Accepts any CSS color value or variable.
   * Pass `"neutral"` (or omit when there is no icon) for a plain card.
   * Defaults to `var(--teal)`.
   */
  color?: string;
}

function StatIcon({ Icon, color }: { Icon: LucideIcon; color: string }) {
  return (
    <span
      className="shrink-0 rounded-[var(--radius-md)] p-[var(--space-2)]"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
      aria-hidden
    >
      <Icon size={18} style={{ color }} />
    </span>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "var(--teal)",
}: StatCardProps) {
  return (
    <Card className="sm:p-[var(--surface-pad-compact)]">
      <div className={Icon ? "flex items-center gap-[var(--space-3)]" : undefined}>
        {Icon && <StatIcon Icon={Icon} color={color} />}
        <div className="min-w-0">
          <p className="m-0 text-[length:var(--type-ui)] text-text-subtle">{label}</p>
          <p
            className="m-0 font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-metric)] text-text leading-tight tabular-nums"
          >
            {value}
          </p>
          {sub && (
            <p className="m-0 text-[length:var(--type-label)] text-text-subtle mt-[var(--space-1)]">
              {sub}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
