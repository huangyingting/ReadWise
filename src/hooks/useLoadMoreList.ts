"use client";

/**
 * useLoadMoreList — generic offset-based load-more hook (REF-058).
 *
 * Encapsulates the repeated state machine found across CategoryBrowser,
 * ForYouFeed, and PersonalImports:
 *   - articles list (append + deduplicate by id)
 *   - progress map (merge)
 *   - offset, hasMore, loading, loadError
 *   - loadingRef double-tap guard
 *
 * The caller provides a `fetchPage` function that is responsible for building
 * the endpoint-specific URL and returning the raw API payload. The hook
 * normalises the `articles`, `progress`, `hasMore`, and `offset` fields.
 * Any extra payload fields (e.g. ForYouFeed's `reasons`) can be handled via
 * the optional `onPageLoaded` callback.
 *
 * fetchPage is called through a ref so callers do not need to memoize it.
 */

import { useCallback, useRef, useState } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/engagement/progress";

/** Minimum shape that a page response must satisfy. */
export type LoadMorePage = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

type UseLoadMoreListOptions<TPage extends LoadMorePage> = {
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
  /** Fetch the next page starting at `offset`. Should throw on network/HTTP error. */
  fetchPage: (offset: number) => Promise<TPage>;
  /**
   * Called after articles/progress/offset/hasMore state has been committed.
   * Receives the raw page response and the newly appended articles (before
   * dedup filtering). Use to update component-local extra state (reasons,
   * announcements, etc.).
   */
  onPageLoaded?: (page: TPage, newArticles: ListingArticle[]) => void;
  /** Shown in the error banner when loading fails. */
  errorMessage?: string;
};

export type UseLoadMoreListResult = {
  articles: ListingArticle[];
  progress: Record<string, ProgressSummary>;
  hasMore: boolean;
  loading: boolean;
  loadError: string | null;
  /** Idempotent — safe to call while already loading or when hasMore is false. */
  loadMore: () => void;
};

/**
 * Appends `next` to `prev` after filtering out ids that already exist in
 * `prev`. Exported for unit testing.
 */
export function deduplicateArticles(
  prev: ListingArticle[],
  next: ListingArticle[],
): ListingArticle[] {
  const seen = new Set(prev.map((a) => a.id));
  return [...prev, ...next.filter((a) => !seen.has(a.id))];
}

export function useLoadMoreList<TPage extends LoadMorePage>({
  initialArticles,
  initialProgress,
  initialHasMore,
  initialOffset,
  fetchPage,
  onPageLoaded,
  errorMessage = "Couldn't load more articles — please try again.",
}: UseLoadMoreListOptions<TPage>): UseLoadMoreListResult {
  const [articles, setArticles] = useState<ListingArticle[]>(initialArticles);
  const [progress, setProgress] =
    useState<Record<string, ProgressSummary>>(initialProgress);
  const [offset, setOffset] = useState<number>(initialOffset);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ref-tracked guard — prevents double-firing when the state update hasn't
  // landed yet between rapid clicks. Mirrors the pattern in the originals.
  const loadingRef = useRef(false);

  // Keep mutable refs so these don't need to be useCallback dependencies.
  // The async IIFE always reads .current at call time, never a stale closure.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const onPageLoadedRef = useRef(onPageLoaded);
  onPageLoadedRef.current = onPageLoaded;
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const page = await fetchPageRef.current(offset);
        const next = page.articles ?? [];
        setArticles((prev) => deduplicateArticles(prev, next));
        setProgress((prev) => ({ ...prev, ...(page.progress ?? {}) }));
        setOffset(page.offset ?? offset + next.length);
        setHasMore(Boolean(page.hasMore));
        onPageLoadedRef.current?.(page, next);
      } catch {
        setLoadError(errorMessageRef.current);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    })();
    // offset + hasMore are the only values captured inside the closure body
    // that must be fresh on each call. All other deps go through refs.
  }, [offset, hasMore]);

  return { articles, progress, hasMore, loading, loadError, loadMore };
}
