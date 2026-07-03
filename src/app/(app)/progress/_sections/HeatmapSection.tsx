/**
 * HeatmapSection — 52-week reading activity heatmap (REF-059).
 */
import { Card } from "@/components/ui/Card";
import ActivityHeatmap from "@/components/ActivityHeatmap";
import type { HeatCell } from "@/lib/engagement";

const HEADING_ID = "heatmap-h";
const HEADING_CLASS_NAME =
  "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]";

interface HeatmapSectionProps {
  heatmapCells: HeatCell[];
}

export function HeatmapSection({ heatmapCells }: HeatmapSectionProps) {
  return (
    <section aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className={HEADING_CLASS_NAME}>
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
