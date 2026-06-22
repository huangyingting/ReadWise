"use client";

import { useCallback, useRef, useState } from "react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import { Button } from "@/components/ui/Button";

type ImportsResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

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
}: {
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
}) {
  const [articles, setArticles] = useState<ListingArticle[]>(initialArticles);
  const [progress, setProgress] =
    useState<Record<string, ProgressSummary>>(initialProgress);
  const [offset, setOffset] = useState<number>(initialOffset);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      const res = await fetch(`/api/articles/import?${params.toString()}`);
      if (!res.ok) {
        setLoadError("Couldn't load more imports — please try again.");
        return;
      }
      const data = (await res.json()) as ImportsResponse;
      const next = data.articles ?? [];
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...next.filter((a) => !seen.has(a.id))];
      });
      setProgress((prev) => ({ ...prev, ...(data.progress ?? {}) }));
      setOffset(data.offset ?? offset + next.length);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setLoadError("Couldn't load more imports — please try again.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [offset, hasMore]);

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
          />
        ))}
      </div>

      {hasMore ? (
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
            onClick={() => void loadMore()}
          >
            {loadError ? "Retry" : "Load more"}
          </Button>
        </div>
      ) : null}

      <ListingProgressSync articleIds={articles.map((a) => a.id)} />
    </section>
  );
}
