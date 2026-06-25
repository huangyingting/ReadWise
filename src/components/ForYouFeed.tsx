"use client";

import Link from "next/link";
import { Compass, CheckCircle2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { Button, buttonVariants } from "@/components/ui/Button";
import { getJson } from "@/lib/client-fetch";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import EmptyState from "@/components/EmptyState";
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
 * Mirrors CategoryBrowser — same Load-more pattern, same grid markup, same
 * ListingProgressSync + ListingBookmarkSync — but targets GET /api/feed
 * (personalized ranking) instead of /api/articles (category browse).
 *
 * Card DOM contract: every ArticleCardView rendered here carries the full
 * data-article-id + js-progress-* + .js-bookmark hooks verbatim via the
 * unchanged ArticleCardView. The only addition is the optional `reason` prop
 * which renders a .rw-why-chip between byline ③ and the progress footer ④⑤
 * and touches none of the sync hooks.
 *
 * @see CategoryBrowser for the source pattern
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

  const articleIds = articles.map((a) => a.id);

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
      {/* Visually-hidden live region: announces Load more results to screen readers */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </span>

      {/* Card grid — identical markup to M4 listings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-5)] rw-fade-up">
        {articles.map((article) => (
          <ArticleCardView
            key={article.id}
            article={article}
            progress={progress[article.id]}
            saved={savedIds.has(article.id)}
            reason={reasons[article.id]}
          />
        ))}
      </div>

      {/* Load more / end-cap */}
      {hasMore ? (
        <div className="mt-[var(--space-7)] flex flex-col items-center gap-[var(--space-3)]">
          {loadError ? (
            <p
              role="alert"
              className="text-[length:var(--text-sm)] text-danger-text m-0 text-center"
            >
              {loadError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="md"
            loading={loading}
            onClick={() => void loadMore()}
          >
            {loadError ? "Retry" : "Load more"}
          </Button>
        </div>
      ) : (
        /* End-of-feed cap: shown once all pages are loaded */
        <p
          role="status"
          className="text-center text-text-muted text-[length:var(--text-sm)] mt-[var(--space-7)]"
        >
          <CheckCircle2 size={14} aria-hidden className="inline -mt-px mr-[var(--space-1)] text-text-subtle" />
          {"You're all caught up. "}
          <Link
            href="/browse"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Browse by topic <span aria-hidden="true">→</span>
          </Link>
        </p>
      )}

      {/* Progress + bookmark sync over the growing article id set */}
      <ListingSync articleIds={articleIds} />
    </div>
  );
}
