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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await requireOnboardedSession("/dashboard");
  const { level: levelParam } = await searchParams;
  const maxLevel = isDifficultyLevel(levelParam) ? levelParam : null;

  const vm = await loadDashboardViewModel(session.user, maxLevel);

  return (
    <PageShell variant="listing">
      <PageHeader title="Dashboard" />

      <DashboardIdentityCard user={vm.user} />

      {/* First-run welcome banner — shown once to new users (localStorage-gated client-side) */}
      {vm.isNewUser && <DashboardWelcomeBanner />}

      {/* Level progression recommendation — shown when confidence ≥ 0.6 */}
      {vm.profile && (
        <div className="mt-[var(--space-5)]">
          <LevelRecommendationBanner profile={vm.profile} />
        </div>
      )}

      <DashboardProgressBand
        streak={vm.streak}
        mastery={vm.mastery}
        dueCount={vm.dueCount}
      />

      <DashboardContinueReadingRail
        inProgressEntries={vm.inProgressEntries}
        bookmarkedIds={vm.bookmarkedIds}
        railIds={vm.railIds}
      />

      <DashboardForYouSection
        hasTopics={vm.hasTopics}
        maxLevel={vm.maxLevel}
        feedPage={vm.feedPage}
        filteredArticles={vm.filteredArticles}
        filteredHasMore={vm.filteredHasMore}
        feedProgress={vm.feedProgress}
        bookmarkedIds={vm.bookmarkedIds}
        feedIds={vm.feedIds}
      />

      <DashboardBrowseCta />
    </PageShell>
  );
}

