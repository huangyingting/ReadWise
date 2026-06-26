"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ApiResponseError } from "@/lib/client-fetch";

export interface MutationRunOptions<T> {
  /** Called with the result after a successful run, before `refreshOnSuccess`. */
  onSuccess?: (result: T) => void | Promise<void>;
  /** Call `router.refresh()` after a successful run (server-component re-fetch). */
  refreshOnSuccess?: boolean;
  /** Overrides the hook-level fallback message for this run only. */
  fallbackMessage?: string;
}

export interface UseMutationState {
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  clearError: () => void;
  run: <T>(
    fn: () => Promise<T>,
    options?: MutationRunOptions<T>,
  ) => Promise<T | undefined>;
}

/**
 * Unified mutation leaf: manages busy + error state for a single async
 * operation. Maps ApiResponseError (and generic Error) to the error string the
 * component can display directly. Does NOT log operation inputs to avoid
 * leaking private user content (article text, prompts, credentials).
 *
 * `run` accepts options:
 *   - `onSuccess(result)`    — side effect after a successful run.
 *   - `refreshOnSuccess`     — calls `router.refresh()` on success so server
 *                              components re-fetch.
 *   - `fallbackMessage`      — per-run override of the default error message.
 *
 * This is the single source of truth for mutation state; useAdminAction builds
 * on top of it.
 */
export function useMutation(
  fallbackMessage = "Something went wrong",
): UseMutationState {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      options?: MutationRunOptions<T>,
    ): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        await options?.onSuccess?.(result);
        if (options?.refreshOnSuccess) {
          router.refresh();
        }
        return result;
      } catch (err) {
        if (err instanceof ApiResponseError || err instanceof Error) {
          setError(err.message);
        } else {
          setError(options?.fallbackMessage ?? fallbackMessage);
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fallbackMessage, router],
  );

  return { busy, error, setError, clearError, run };
}
