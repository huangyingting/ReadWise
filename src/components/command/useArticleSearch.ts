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

async function fetchSearch(
  query: string,
  signal: AbortSignal,
  offset?: number,
): Promise<SearchResponse> {
  const offsetParam = offset !== undefined ? `&offset=${offset}` : "";
  const url = `/api/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}${offsetParam}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new SearchHttpError(res.status);
  return (await res.json()) as SearchResponse;
}

export function useArticleSearch() {
  const [state, setState] = useState<ArticleSearchState>(INITIAL_STATE);
  // Debounce + abort + stale-response guarding is delegated to useFilteredFetch.
  const { run, cancel } = useFilteredFetch<SearchResponse>(DEBOUNCE_MS);

  const search = useCallback(
    (query: string) => {
      const trimmed = query.trim();

      if (trimmed.length < 2) {
        cancel();
        setState(INITIAL_STATE);
        return;
      }

      // Immediately switch to loading so the spinner + skeletons appear.
      // Keep existing articles so refinements don't flash empty.
      setState((prev) => ({ ...prev, status: "loading" }));

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
            error:
              err instanceof SearchHttpError
                ? `Search failed (${err.status})`
                : "Couldn't load articles.",
          })),
      });
    },
    [run, cancel],
  );

  const loadMore = useCallback(
    (query: string, offset: number) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) return;

      setState((prev) => ({ ...prev, status: "loading" }));

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
            error:
              err instanceof SearchHttpError
                ? "Search failed."
                : "Couldn't load articles.",
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
