"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clientErrorMessage } from "@/lib/client-fetch";

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
 * operation. Preserves controlled ApiResponseError messages while mapping
 * arbitrary exceptions to a fixed fallback. Does NOT log operation inputs or
 * exception prose to avoid leaking private user content (article text,
 * prompts, credentials).
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
        setError(
          clientErrorMessage(
            err,
            options?.fallbackMessage ?? fallbackMessage,
          ),
        );
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fallbackMessage, router],
  );

  return { busy, error, setError, clearError, run };
}
