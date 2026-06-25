/**
 * LevelTimelineSection — CEFR progression timeline; renders only when the
 * user has a current level (REF-059).
 */
import { Card } from "@/components/ui/Card";
import LevelTimeline from "@/components/LevelTimeline";
import type { LevelEntry } from "@/lib/progress-helpers";
import type { EnglishLevel } from "@/lib/option-registries";

interface LevelTimelineSectionProps {
  levelHistory: LevelEntry[];
  currentLevel: EnglishLevel | null;
}

export function LevelTimelineSection({ levelHistory, currentLevel }: LevelTimelineSectionProps) {
  if (!currentLevel) return null;

  return (
    <section aria-labelledby="timeline-h">
      <h2
        id="timeline-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Level progression
      </h2>
      <Card>
        <LevelTimeline history={levelHistory} currentLevel={currentLevel} />
      </Card>
    </section>
  );
}
