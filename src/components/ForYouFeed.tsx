"use client";

import Link from "next/link";
import { Compass, CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/engagement";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui";
import { getJson } from "@/lib/client-fetch";
import ArticleListingGrid from "@/components/ArticleListingGrid";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";

/** Shape returned by GET /api/feed */
type FeedApiResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
  reasons?: Record<string, string>;
};

/**
 * M15 "For You" feed client component.
 *
 * Thin wrapper over {@link useLoadMoreList} + {@link ArticleListingGrid} that
 * targets GET /api/feed (personalized ranking) instead of /api/articles
 * (category browse). The shared grid preserves the M4 card DOM contract
 * (data-article-id + js-progress-* + .js-bookmark hooks) verbatim; the only
 * feed-specific additions are the per-card `reason` chip, the screen-reader
 * live region, and the "you're all caught up" end-cap.
 *
 * @see CategoryBrowser for the sibling feed
 */
export default function ForYouFeed({
  initialArticles,
  initialProgress,
  initialHasMore,
  initialOffset,
  initialSavedIds,
  initialReasons,
  level,
}: {
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
  /** SSR saved article ids — bookmark overlay initial state. */
  initialSavedIds?: string[];
  /** SSR personalisation reasons keyed by articleId. */
  initialReasons?: Record<string, string>;
  /** Active CEFR level cap — threaded to /api/feed so Load more stays filtered. */
  level?: string | null;
}) {
  const [savedIds] = useState<Set<string>>(() => new Set(initialSavedIds ?? []));
  const [reasons, setReasons] = useState<Record<string, string>>(initialReasons ?? {});
  // live-region text for a11y ("N more articles loaded")
  const [announcement, setAnnouncement] = useState<string>("");

  const fetchPage = useCallback(
    async (nextOffset: number): Promise<FeedApiResponse> => {
      const params = new URLSearchParams({
        offset: String(nextOffset),
        limit: "6",
      });
      if (level) params.set("level", level);
      return getJson<FeedApiResponse>(`/api/feed?${params.toString()}`);
    },
    [level],
  );

  const { articles, progress, hasMore, loading, loadError, loadMore } =
    useLoadMoreList({
      initialArticles,
      initialProgress,
      initialHasMore,
      initialOffset,
      fetchPage,
      onPageLoaded: useCallback(
        (page: FeedApiResponse, newArticles: ListingArticle[]) => {
          setReasons((prev) => ({ ...prev, ...(page.reasons ?? {}) }));
          if (newArticles.length > 0) {
            setAnnouncement(
              `${newArticles.length} more article${newArticles.length === 1 ? "" : "s"} loaded`,
            );
          }
        },
        [],
      ),
    });

  if (articles.length === 0) {
    // Cold-start: no articles — parent handles this via EmptyState before
    // mounting ForYouFeed when topics are empty. This branch handles the case
    // where topics exist but nothing matched (everything read / no level match).
    return (
      <EmptyState
        icon={Compass}
        title="Nothing new for you right now"
        description="You're all caught up on your topics. Explore other categories while we find more."
        action={{ label: "Browse categories", href: "/browse" }}
      />
    );
  }

  return (
    <div>
      <ArticleListingGrid
        articles={articles}
        progress={progress}
        savedIds={savedIds}
        reasons={reasons}
        hasMore={hasMore}
        loading={loading}
        loadError={loadError}
        onLoadMore={() => void loadMore()}
        beforeGrid={
          /* Visually-hidden live region: announces Load more results to screen readers */
          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </span>
        }
        endCap={
          /* End-of-feed cap: shown once all pages are loaded */
          <p
            role="status"
            className="text-center text-text-muted text-[length:var(--text-sm)] mt-[var(--space-7)]"
          >
            <CheckCircle2 size={14} aria-hidden className="inline -mt-px mr-[var(--space-1)] text-text-subtle" />
            {"You're all caught up. "}
            <Link href="/browse" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Browse by topic <span aria-hidden="true">→</span>
            </Link>
          </p>
        }
      />
    </div>
  );
}
