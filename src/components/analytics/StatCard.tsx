/**
 * StatCard — metric summary card used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access. The `icon` prop is optional; omit it to render a compact
 * label/value card without an icon chip (suitable for admin stat grids).
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

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "var(--teal)",
}: StatCardProps) {
  return (
    <Card>
      <div className={Icon ? "flex items-start gap-[var(--space-3)]" : undefined}>
        {Icon && (
          <span
            className="shrink-0 rounded-[var(--radius-md)] p-[var(--space-2)]"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
            aria-hidden
          >
            <Icon size={20} style={{ color }} />
          </span>
        )}
        <div>
          <p className="text-[length:var(--text-sm)] text-text-subtle">{label}</p>
          <p
            className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text leading-tight"
          >
            {value}
          </p>
          {sub && (
            <p className="text-[length:var(--text-xs)] text-text-subtle mt-[var(--space-1)]">
              {sub}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
