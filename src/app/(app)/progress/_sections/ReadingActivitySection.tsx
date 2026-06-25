/**
 * ReadingActivitySection — weekly bar chart of article completions (REF-059).
 */
import { Card } from "@/components/ui/Card";
import { WeeklyBars } from "@/components/analytics/WeeklyBars";
import type { LearnerAnalytics } from "@/lib/learner-analytics";

interface ReadingActivitySectionProps {
  completionsByWeek: LearnerAnalytics["completionsByWeek"];
}

export function ReadingActivitySection({ completionsByWeek }: ReadingActivitySectionProps) {
  return (
    <section aria-labelledby="reading-h">
      <h2
        id="reading-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Reading activity
        <span className="ml-2 text-[length:var(--text-sm)] font-normal text-text-subtle">
          last 12 weeks
        </span>
      </h2>
      <Card>
        <WeeklyBars
          buckets={completionsByWeek}
          label="Articles completed per week over the last 12 weeks"
          color="var(--teal)"
        />
        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
          Completed articles per week
        </p>
      </Card>
    </section>
  );
}
