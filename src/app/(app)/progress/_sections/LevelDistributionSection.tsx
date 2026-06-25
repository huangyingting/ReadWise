/**
 * LevelDistributionSection — horizontal mini bars showing completed article
 * counts by CEFR level; renders only when the user has completed articles
 * (REF-059).
 */
import { Card } from "@/components/ui/Card";
import { MiniBar } from "@/components/analytics/MiniBar";
import type { LearnerAnalytics } from "@/lib/analytics/learner";

interface LevelDistributionSectionProps {
  completedByLevel: LearnerAnalytics["completedByLevel"];
}

export function LevelDistributionSection({ completedByLevel }: LevelDistributionSectionProps) {
  if (completedByLevel.length === 0) return null;

  return (
    <section aria-labelledby="level-h">
      <h2
        id="level-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Level distribution
        <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
          completed articles
        </span>
      </h2>
      <Card>
        <div className="flex flex-col gap-[var(--space-3)]">
          {completedByLevel.map((b) => {
            const maxCount = Math.max(...completedByLevel.map((x) => x.count), 1);
            return (
              <div key={b.level} className="flex items-center gap-[var(--space-3)]">
                <span
                  className="shrink-0 text-[length:var(--text-sm)] font-semibold text-text-subtle tabular-nums"
                  style={{ minWidth: "3ch" }}
                >
                  {b.level}
                </span>
                <div className="flex-1">
                  <MiniBar
                    value={b.count}
                    max={maxCount}
                    label={`${b.level} articles`}
                    color="var(--teal)"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
