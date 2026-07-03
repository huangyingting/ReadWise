/**
 * ReadingActivitySection — weekly bar chart of article completions (REF-059).
 */
import { Card } from "@/components/ui/Card";
import { WeeklyBars } from "@/components/analytics/WeeklyBars";
import type { LearnerAnalytics } from "@/lib/analytics/learner";

interface ReadingActivitySectionProps {
  completionsByWeek: LearnerAnalytics["completionsByWeek"];
}

const READING_ACTIVITY_CHART = {
  label: "Articles completed per week over the last 12 weeks",
  color: "var(--teal)",
  caption: "Completed articles per week",
} as const;

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
          label={READING_ACTIVITY_CHART.label}
          color={READING_ACTIVITY_CHART.color}
        />
        <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-text-subtle">
          {READING_ACTIVITY_CHART.caption}
        </p>
      </Card>
    </section>
  );
}
