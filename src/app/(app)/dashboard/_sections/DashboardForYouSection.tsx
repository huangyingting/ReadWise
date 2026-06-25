/**
 * DashboardForYouSection — personalised article feed with level filter and
 * cold-start empty state (REF-059).
 */
import { Sparkles, SlidersHorizontal } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ForYouFeed from "@/components/ForYouFeed";
import DashboardLevelFilter from "@/components/DashboardLevelFilter";
import type { FeedPage } from "@/lib/feed";
import type { ProgressSummary } from "@/lib/engagement/progress";
import type { DifficultyLevel } from "@/lib/difficulty";

interface DashboardForYouSectionProps {
  hasTopics: boolean;
  maxLevel: DifficultyLevel | null;
  feedPage: FeedPage;
  filteredArticles: FeedPage["articles"];
  filteredHasMore: boolean;
  feedProgress: Record<string, ProgressSummary>;
  bookmarkedIds: Set<string>;
  feedIds: string[];
}

export function DashboardForYouSection({
  hasTopics,
  maxLevel,
  feedPage,
  filteredArticles,
  filteredHasMore,
  feedProgress,
  bookmarkedIds,
  feedIds,
}: DashboardForYouSectionProps) {
  return (
    <section aria-labelledby="foryou-h" className="mt-[var(--space-7)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] mb-[var(--space-2)]">
        <h2
          id="foryou-h"
          className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0"
        >
          For You
        </h2>

        {/* CEFR level filter — US-017 (#68). Client component handles auto-submit. */}
        <DashboardLevelFilter defaultValue={maxLevel ?? null} />
      </div>

      {/* Personalisation cue — calm, informational */}
      <p className="text-text-muted text-[length:var(--text-sm)] mt-0 mb-[var(--space-5)]">
        <SlidersHorizontal size={14} aria-hidden className="inline -mt-px mr-[var(--space-1)] text-text-subtle" />
        Based on your level and topics
      </p>

      {/* Cold-start (a): no topics chosen → send to settings */}
      {!hasTopics ? (
        <EmptyState
          icon={Sparkles}
          title="Pick a few topics to personalize your feed"
          description="Tell us what you like and we'll line up articles at your level."
          action={{ label: "Choose topics", href: "/settings" }}
        />
      ) : (
        /* Topics chosen — hand off to client component (handles empty + load more + sync) */
        <ForYouFeed
          key={maxLevel ?? "all"}
          level={maxLevel}
          initialArticles={filteredArticles}
          initialProgress={feedProgress}
          initialHasMore={filteredHasMore}
          initialOffset={filteredArticles.length}
          initialSavedIds={[...bookmarkedIds].filter((id) => feedIds.includes(id))}
          initialReasons={feedPage.reasons}
        />
      )}
    </section>
  );
}
