"use client";

import Link from "next/link";
import { Compass, CheckCircle2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { Button, buttonVariants } from "@/components/ui/Button";
import { getJson } from "@/lib/client-fetch";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import EmptyState from "@/components/EmptyState";

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
  const [articles, setArticles] = useState<ListingArticle[]>(initialArticles);
  const [progress, setProgress] = useState<Record<string, ProgressSummary>>(initialProgress);
  const [savedIds] = useState<Set<string>>(() => new Set(initialSavedIds ?? []));
  const [reasons, setReasons] = useState<Record<string, string>>(initialReasons ?? {});
  const [offset, setOffset] = useState<number>(initialOffset);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Ref-tracked loading flag so loadMore never reads a stale closure value —
  // mirrors CategoryBrowser's double-tap guard.
  const loadingRef = useRef(false);
  // live-region text for a11y ("N more articles loaded")
  const [announcement, setAnnouncement] = useState<string>("");

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: "6" });
      if (level) params.set("level", level);
      const data = await getJson<FeedApiResponse>(`/api/feed?${params.toString()}`);
      const next = data.articles ?? [];
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...next.filter((a) => !seen.has(a.id))];
      });
      setProgress((prev) => ({ ...prev, ...(data.progress ?? {}) }));
      setReasons((prev) => ({ ...prev, ...(data.reasons ?? {}) }));
      setOffset(data.offset ?? offset + next.length);
      setHasMore(Boolean(data.hasMore));
      if (next.length > 0) {
        setAnnouncement(`${next.length} more article${next.length === 1 ? "" : "s"} loaded`);
      }
    } catch {
      setLoadError("Couldn't load more articles — please try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [offset, hasMore, level]);

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
      <ListingProgressSync articleIds={articleIds} />
      <ListingBookmarkSync articleIds={articleIds} />
    </div>
  );
}
