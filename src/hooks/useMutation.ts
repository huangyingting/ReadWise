"use client";

import { useState, useCallback } from "react";
import { ApiResponseError } from "@/lib/client-fetch";

export interface UseMutationState {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * Minimal mutation helper: manages busy + error state for a single async
 * operation. Maps ApiResponseError (and generic Error) to the error string
 * the component can display directly. Does NOT log operation inputs to avoid
 * leaking private user content (article text, prompts, credentials).
 */
export function useMutation(
  fallbackMessage = "Something went wrong",
): UseMutationState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ApiResponseError || err instanceof Error) {
          setError(err.message);
        } else {
          setError(fallbackMessage);
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fallbackMessage],
  );

  return { busy, error, clearError, run };
}
