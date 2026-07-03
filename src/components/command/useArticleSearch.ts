"use client";

import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/article-library";
import { useFilteredFetch } from "@/hooks/useFilteredFetch";

export type SearchStatus = "idle" | "loading" | "done" | "error";

export interface ArticleSearchState {
  status: SearchStatus;
  articles: ListingArticle[];
  hasMore: boolean;
  nextOffset: number;
  error: string | null;
}

const INITIAL_STATE: ArticleSearchState = {
  status: "idle",
  articles: [],
  hasMore: false,
  nextOffset: 0,
  error: null,
};

const SEARCH_LIMIT = 7;
const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

type SearchResponse = {
  articles: ListingArticle[];
  hasMore: boolean;
  offset: number;
};

/** Carries the HTTP status so callers can format the error message. */
class SearchHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Search failed (${status})`);
    this.name = "SearchHttpError";
  }
}

function normalizeSearchQuery(query: string): string {
  return query.trim();
}

function isSearchableQuery(query: string): boolean {
  return query.length >= MIN_QUERY_LENGTH;
}

function getSearchUrl(query: string, offset?: number): string {
  const offsetParam = offset !== undefined ? `&offset=${offset}` : "";
  return `/api/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}${offsetParam}`;
}

function markLoading(prev: ArticleSearchState): ArticleSearchState {
  return { ...prev, status: "loading" };
}

function formatSearchError(err: unknown, includeStatus: boolean): string {
  if (!(err instanceof SearchHttpError)) return "Couldn't load articles.";
  return includeStatus ? `Search failed (${err.status})` : "Search failed.";
}

async function fetchSearch(
  query: string,
  signal: AbortSignal,
  offset?: number,
): Promise<SearchResponse> {
  const res = await fetch(getSearchUrl(query, offset), { signal });
  if (!res.ok) throw new SearchHttpError(res.status);
  return (await res.json()) as SearchResponse;
}

export function useArticleSearch() {
  const [state, setState] = useState<ArticleSearchState>(INITIAL_STATE);
  // Debounce + abort + stale-response guarding is delegated to useFilteredFetch.
  const { run, cancel } = useFilteredFetch<SearchResponse>(DEBOUNCE_MS);

  const search = useCallback(
    (query: string) => {
      const trimmed = normalizeSearchQuery(query);

      if (!isSearchableQuery(trimmed)) {
        cancel();
        setState(INITIAL_STATE);
        return;
      }

      // Immediately switch to loading so the spinner + skeletons appear.
      // Keep existing articles so refinements don't flash empty.
      setState(markLoading);

      run({
        fetcher: (signal) => fetchSearch(trimmed, signal),
        onResult: (data) =>
          setState({
            status: "done",
            articles: data.articles,
            hasMore: data.hasMore,
            nextOffset: data.offset,
            error: null,
          }),
        onError: (err) =>
          setState((prev) => ({
            ...prev,
            status: "error",
            error: formatSearchError(err, true),
          })),
      });
    },
    [run, cancel],
  );

  const loadMore = useCallback(
    (query: string, offset: number) => {
      const trimmed = normalizeSearchQuery(query);
      if (!isSearchableQuery(trimmed)) return;

      setState(markLoading);

      run({
        immediate: true,
        fetcher: (signal) => fetchSearch(trimmed, signal, offset),
        onResult: (data) =>
          setState((prev) => ({
            ...prev,
            status: "done",
            articles: [...prev.articles, ...data.articles],
            hasMore: data.hasMore,
            nextOffset: data.offset,
            error: null,
          })),
        onError: (err) =>
          setState((prev) => ({
            ...prev,
            status: "error",
            error: formatSearchError(err, false),
          })),
      });
    },
    [run],
  );

  const reset = useCallback(() => {
    cancel();
    setState(INITIAL_STATE);
  }, [cancel]);

  return { ...state, search, loadMore, reset };
}
