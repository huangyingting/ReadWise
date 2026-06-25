import { TrendingUp } from "lucide-react";
import { requireOnboardedSession } from "@/lib/session";
import EmptyState from "@/components/EmptyState";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";
import { progress } from "@/lib/copy/pages";
import { loadProgressViewModel } from "@/app/(app)/progress/view-model";
import { ProgressOverviewSection } from "@/app/(app)/progress/_sections/ProgressOverviewSection";
import { ReadingActivitySection } from "@/app/(app)/progress/_sections/ReadingActivitySection";
import { VocabularyGrowthSection } from "@/app/(app)/progress/_sections/VocabularyGrowthSection";
import { QuizTrendSection } from "@/app/(app)/progress/_sections/QuizTrendSection";
import { LevelDistributionSection } from "@/app/(app)/progress/_sections/LevelDistributionSection";
import { HeatmapSection } from "@/app/(app)/progress/_sections/HeatmapSection";
import { LevelTimelineSection } from "@/app/(app)/progress/_sections/LevelTimelineSection";

export const metadata = progress;

export default async function ProgressPage() {
  const session = await requireOnboardedSession("/progress");
  const vm = await loadProgressViewModel(session.user.id);

  return (
    <PageShell variant="listing">
      <PageHeader title="My Progress" />

      {!vm.hasAnyData && !vm.currentLevel ? (
        <EmptyState
          icon={TrendingUp}
          title="Nothing to show yet"
          description="Read some articles, save words, or take quizzes to see your progress here."
          action={{ label: "Browse articles", href: "/browse" }}
        />
      ) : (
        <div className="flex flex-col gap-[var(--space-7)]">

          {vm.hasAnyData && (
            <>
              <ProgressOverviewSection analytics={vm.analytics} speedStats={vm.speedStats} />
              <ReadingActivitySection completionsByWeek={vm.analytics.completionsByWeek} />
              <VocabularyGrowthSection
                wordsByWeek={vm.analytics.wordsByWeek}
                totalSavedWords={vm.analytics.totalSavedWords}
              />
              <QuizTrendSection
                quizScoreTrend={vm.analytics.quizScoreTrend}
                averageQuizScore={vm.analytics.averageQuizScore}
                totalQuizAttempts={vm.analytics.totalQuizAttempts}
                sparkLabel={vm.sparkLabel}
              />
              <LevelDistributionSection completedByLevel={vm.analytics.completedByLevel} />
            </>
          )}

          <HeatmapSection heatmapCells={vm.heatmapCells} />
          <LevelTimelineSection levelHistory={vm.levelHistory} currentLevel={vm.currentLevel} />

        </div>
      )}
    </PageShell>
  );
}
