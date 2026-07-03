"use client";

import { useCallback } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/engagement";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import { Button } from "@/components/ui/Button";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";

type ImportsResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

type PersonalImportsProps = {
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
  /** Today Session v1.1 (#805): enable the "Set as today's article" card overlay. */
  setTodayEnabled?: boolean;
};

type LoadMoreControlsProps = {
  loading: boolean;
  loadError: string | null;
  loadMore: () => void;
};

function getImportsPageUrl(nextOffset: number): string {
  const params = new URLSearchParams({ offset: String(nextOffset) });
  return `/api/articles/import?${params.toString()}`;
}

function LoadMoreControls({
  loading,
  loadError,
  loadMore,
}: LoadMoreControlsProps) {
  return (
    <div className="mt-[var(--space-6)] flex flex-col items-center gap-[var(--space-3)]">
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
        onClick={() => loadMore()}
      >
        {loadError ? "Retry" : "Load more"}
      </Button>
    </div>
  );
}

/**
 * Client "My Imports" list with offset-based "Load more" pagination so older
 * imports beyond the first page stay reachable. Mirrors the CategoryBrowser
 * load-more pattern: an initial server-rendered page is hydrated here, then
 * subsequent pages are fetched from GET /api/articles/import and appended.
 */
export default function PersonalImports({
  initialArticles,
  initialProgress,
  initialHasMore,
  initialOffset,
  setTodayEnabled = false,
}: PersonalImportsProps) {
  const fetchPage = useCallback(
    async (nextOffset: number): Promise<ImportsResponse> => {
      const res = await fetch(getImportsPageUrl(nextOffset));
      if (!res.ok) throw new Error("fetch failed");
      return (await res.json()) as ImportsResponse;
    },
    [],
  );

  const { articles, progress, hasMore, loading, loadError, loadMore } =
    useLoadMoreList({
      initialArticles,
      initialProgress,
      initialHasMore,
      initialOffset,
      fetchPage,
      errorMessage: "Couldn't load more imports — please try again.",
    });

  if (articles.length === 0) return null;

  return (
    <section className="mt-[var(--space-7)]">
      <h2 className="font-semibold text-[length:var(--text-lg)] text-text mb-[var(--space-4)]">
        My Imports
      </h2>
      <div className="grid gap-[var(--space-4)]">
        {articles.map((article) => (
          <ArticleCardView
            key={article.id}
            article={article}
            progress={progress[article.id]}
            setTodayEnabled={setTodayEnabled}
          />
        ))}
      </div>

      {hasMore ? (
        <LoadMoreControls
          loading={loading}
          loadError={loadError}
          loadMore={loadMore}
        />
      ) : null}

      <ListingSync articleIds={articles.map((a) => a.id)} />
    </section>
  );
}
