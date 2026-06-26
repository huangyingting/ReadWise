/**
 * HeatmapSection — 52-week reading activity heatmap (REF-059).
 */
import { Card } from "@/components/ui/Card";
import ActivityHeatmap from "@/components/ActivityHeatmap";
import type { HeatCell } from "@/lib/engagement";

interface HeatmapSectionProps {
  heatmapCells: HeatCell[];
}

export function HeatmapSection({ heatmapCells }: HeatmapSectionProps) {
  return (
    <section aria-labelledby="heatmap-h">
      <h2
        id="heatmap-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Reading streak
        <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
          last 52 weeks
        </span>
      </h2>
      <Card>
        <ActivityHeatmap cells={heatmapCells} />
      </Card>
    </section>
  );
}
