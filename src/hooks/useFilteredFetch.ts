"use client";

/**
 * useFilteredFetch — debounced, abortable, stale-safe fetch plumbing (FE-6).
 *
 * Encapsulates the debounce-timer + AbortController + discard-stale-response
 * machinery that was hand-rolled in VocabularyJournal and useArticleSearch.
 * The hook owns the timer/controller/request-id refs and the unmount cleanup;
 * callers keep their own (often richer) result state and react via callbacks.
 *
 * Staleness is guarded by a monotonic request id: only the most recent `run`
 * delivers its `onResult`/`onError`. In-flight requests are aborted when a new
 * `run` fires, so superseded responses never overwrite a newer result.
 *
 * Aborts (DOMException/Error `AbortError`) are always swallowed.
 *
 * @param debounceMs Debounce delay applied to non-immediate runs (default 200).
 */

import { useCallback, useEffect, useRef } from "react";

export interface FilteredFetchRun<T> {
  /** Performs the request. Receives the AbortSignal; throw on HTTP error. */
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** Invoked only for the latest (non-superseded) successful response. */
  onResult: (data: T) => void;
  /** Invoked only for the latest non-abort error. Aborts are swallowed. */
  onError?: (error: unknown) => void;
  /** Skip the debounce delay (e.g. pagination / explicit Load more). */
  immediate?: boolean;
}

export interface UseFilteredFetchResult<T> {
  /** Schedule (or immediately fire) a guarded request. */
  run: (options: FilteredFetchRun<T>) => void;
  /** Cancel any pending debounce + in-flight request. */
  cancel: () => void;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useFilteredFetch<T>(debounceMs = 200): UseFilteredFetchResult<T> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Cancel any pending debounce + in-flight request on unmount.
  useEffect(() => cancel, [cancel]);

  const run = useCallback(
    ({ fetcher, onResult, onError, immediate = false }: FilteredFetchRun<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const fire = () => {
        // Abort any prior request so only the latest one can resolve.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = ++requestIdRef.current;

        void (async () => {
          try {
            const data = await fetcher(controller.signal);
            if (controller.signal.aborted || requestId !== requestIdRef.current) return;
            onResult(data);
          } catch (error) {
            if (isAbort(error) || requestId !== requestIdRef.current) return;
            onError?.(error);
          }
        })();
      };

      if (immediate || debounceMs <= 0) {
        fire();
      } else {
        timerRef.current = setTimeout(fire, debounceMs);
      }
    },
    [debounceMs],
  );

  return { run, cancel };
}
