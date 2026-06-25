/**
 * DashboardContinueReadingRail — horizontal rail of in-progress articles with
 * SSR progress + bookmark sync (REF-059).
 */
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import RailScroller from "@/components/RailScroller";
import type { InProgressEntry } from "@/lib/progress";

interface DashboardContinueReadingRailProps {
  inProgressEntries: InProgressEntry[];
  bookmarkedIds: Set<string>;
  railIds: string[];
}

export function DashboardContinueReadingRail({
  inProgressEntries,
  bookmarkedIds,
  railIds,
}: DashboardContinueReadingRailProps) {
  if (inProgressEntries.length === 0) return null;

  return (
    <section className="mt-[var(--space-7)]" aria-label="Continue reading">
      <div className="flex items-center justify-between mb-[var(--space-4)]">
        <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
          Continue reading
        </h2>
        <span className="text-text-muted text-[length:var(--text-sm)]">
          {inProgressEntries.length} in progress
        </span>
      </div>
      <RailScroller>
        {inProgressEntries.map((entry) => (
          <ArticleCardView
            key={entry.article.id}
            article={entry.article}
            progress={entry.progress}
            variant="rail"
            saved={bookmarkedIds.has(entry.article.id)}
          />
        ))}
      </RailScroller>
      {/* Rail sync — rail ids are disjoint from feed ids (in-progress vs unread) */}
      <ListingProgressSync articleIds={railIds} />
      <ListingBookmarkSync articleIds={railIds} />
    </section>
  );
}
