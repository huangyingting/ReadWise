"use client";

import { useCallback, useRef, useState } from "react";
import type { ListingArticle } from "@/lib/article-library";

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

export function useArticleSearch() {
  const [state, setState] = useState<ArticleSearchState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Tracks the latest query to discard stale responses. */
  const latestQueryRef = useRef<string>("");

  const search = useCallback((query: string) => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (trimmed.length < 2) {
      abortRef.current?.abort();
      abortRef.current = null;
      setState(INITIAL_STATE);
      return;
    }

    // Immediately switch to loading so the spinner + skeletons appear.
    // Keep existing articles so refinements don't flash empty.
    setState((prev) => ({ ...prev, status: "loading" }));

    timerRef.current = setTimeout(async () => {
      const queryAtFire = trimmed;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const url = `/api/search?q=${encodeURIComponent(queryAtFire)}&limit=${SEARCH_LIMIT}`;
        const res = await fetch(url, { signal: controller.signal });

        if (latestQueryRef.current !== queryAtFire) return;

        if (!res.ok) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: `Search failed (${res.status})`,
          }));
          return;
        }

        const data: { articles: ListingArticle[]; hasMore: boolean; offset: number } =
          await res.json();

        if (latestQueryRef.current !== queryAtFire) return;

        setState({
          status: "done",
          articles: data.articles,
          hasMore: data.hasMore,
          nextOffset: data.offset,
          error: null,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (latestQueryRef.current !== queryAtFire) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          error: "Couldn't load articles.",
        }));
      }
    }, DEBOUNCE_MS);
  }, []);

  const loadMore = useCallback(async (query: string, offset: number) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const queryAtFire = trimmed;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, status: "loading" }));

    try {
      const url = `/api/search?q=${encodeURIComponent(queryAtFire)}&limit=${SEARCH_LIMIT}&offset=${offset}`;
      const res = await fetch(url, { signal: controller.signal });

      if (latestQueryRef.current !== queryAtFire) return;

      if (!res.ok) {
        setState((prev) => ({ ...prev, status: "error", error: "Search failed." }));
        return;
      }

      const data: { articles: ListingArticle[]; hasMore: boolean; offset: number } =
        await res.json();

      if (latestQueryRef.current !== queryAtFire) return;

      setState((prev) => ({
        ...prev,
        status: "done",
        articles: [...prev.articles, ...data.articles],
        hasMore: data.hasMore,
        nextOffset: data.offset,
        error: null,
      }));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (latestQueryRef.current !== queryAtFire) return;
      setState((prev) => ({ ...prev, status: "error", error: "Couldn't load articles." }));
    }
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    latestQueryRef.current = "";
    setState(INITIAL_STATE);
  }, []);

  return { ...state, search, loadMore, reset };
}
