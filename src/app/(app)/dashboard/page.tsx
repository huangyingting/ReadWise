import { requireOnboardedSession } from "@/lib/session";
import { isDifficultyLevel } from "@/lib/leveling/cefr-primitives";
import LevelRecommendationBanner from "@/components/LevelRecommendationBanner";
import DashboardWelcomeBanner from "@/components/DashboardWelcomeBanner";
import { PageHeader, PageShell } from "@/components/ui";
import { loadDashboardViewModel } from "@/app/(app)/dashboard/view-model";
import { DashboardIdentityCard } from "@/app/(app)/dashboard/_sections/DashboardIdentityCard";
import { DashboardProgressBand } from "@/app/(app)/dashboard/_sections/DashboardProgressBand";
import { DashboardContinueReadingRail } from "@/app/(app)/dashboard/_sections/DashboardContinueReadingRail";
import { DashboardForYouSection } from "@/app/(app)/dashboard/_sections/DashboardForYouSection";
import { DashboardBrowseCta } from "@/app/(app)/dashboard/_sections/DashboardBrowseCta";
import { DashboardTodayCard } from "@/app/(app)/dashboard/_sections/DashboardTodayCard";

type DashboardSearchParams = {
  level?: string;
};

function resolveMaxLevel(levelParam?: string) {
  return isDifficultyLevel(levelParam) ? levelParam : null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const session = await requireOnboardedSession("/dashboard");
  const { level: levelParam } = await searchParams;
  const maxLevel = resolveMaxLevel(levelParam);

  const vm = await loadDashboardViewModel(session.user, maxLevel);
  const {
    user,
    todaySummary,
    isNewUser,
    profile,
    streak,
    mastery,
    dueCount,
    inProgressEntries,
    bookmarkedIds,
    railIds,
    hasTopics,
    maxLevel: resolvedMaxLevel,
    feedPage,
    filteredArticles,
    filteredHasMore,
    feedProgress,
    feedIds,
  } = vm;

  return (
    <PageShell variant="listing">
      <PageHeader title="Dashboard" />

      <DashboardIdentityCard user={user} />

      {/* Today card — secondary entry point to the daily workflow (hidden when
          the Today Session feature is disabled). */}
      {todaySummary && <DashboardTodayCard today={todaySummary} />}

      {/* First-run welcome banner — shown once to new users (localStorage-gated client-side) */}
      {isNewUser && <DashboardWelcomeBanner />}

      {/* Level progression recommendation — shown when confidence ≥ 0.6 */}
      {profile && (
        <div className="mt-[var(--space-5)]">
          <LevelRecommendationBanner profile={profile} />
        </div>
      )}

      <DashboardProgressBand
        streak={streak}
        mastery={mastery}
        dueCount={dueCount}
      />

      <DashboardContinueReadingRail
        inProgressEntries={inProgressEntries}
        bookmarkedIds={bookmarkedIds}
        railIds={railIds}
      />

      <DashboardForYouSection
        hasTopics={hasTopics}
        maxLevel={resolvedMaxLevel}
        feedPage={feedPage}
        filteredArticles={filteredArticles}
        filteredHasMore={filteredHasMore}
        feedProgress={feedProgress}
        bookmarkedIds={bookmarkedIds}
        feedIds={feedIds}
      />

      <DashboardBrowseCta />
    </PageShell>
  );
}
