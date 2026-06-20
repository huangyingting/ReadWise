import { Card, CardMeta } from "@/components/ui/Card";

export function AdminStatCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-[var(--space-4)]">
      <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
        {value}
      </div>
      <CardMeta>{label}</CardMeta>
    </Card>
  );
}
