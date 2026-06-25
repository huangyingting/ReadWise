/**
 * StatCard — metric summary card used in analytics sections (REF-059).
 *
 * Pure presentational component; safe to render with fixture data without
 * database access.
 */
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
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
      <div className="flex items-start gap-[var(--space-3)]">
        <span
          className="shrink-0 rounded-[var(--radius-md)] p-[var(--space-2)]"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
          aria-hidden
        >
          <Icon size={20} style={{ color }} />
        </span>
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
