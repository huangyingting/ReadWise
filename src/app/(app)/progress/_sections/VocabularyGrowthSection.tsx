/**
 * VocabularyGrowthSection — weekly bar chart of words saved; renders only when
 * the user has saved at least one word (REF-059).
 */
import { Card } from "@/components/ui/Card";
import { WeeklyBars } from "@/components/analytics/WeeklyBars";
import type { LearnerAnalytics } from "@/lib/learner-analytics";

interface VocabularyGrowthSectionProps {
  wordsByWeek: LearnerAnalytics["wordsByWeek"];
  totalSavedWords: number;
}

export function VocabularyGrowthSection({
  wordsByWeek,
  totalSavedWords,
}: VocabularyGrowthSectionProps) {
  if (totalSavedWords === 0) return null;

  return (
    <section aria-labelledby="vocab-h">
      <h2
        id="vocab-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Vocabulary growth
        <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
          last 12 weeks
        </span>
      </h2>
      <Card>
        <WeeklyBars
          buckets={wordsByWeek}
          label="Words saved per week over the last 12 weeks"
          color="var(--stat-vocab)"
        />
        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
          Words saved per week
        </p>
      </Card>
    </section>
  );
}
