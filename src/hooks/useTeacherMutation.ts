"use client";

import { useCallback } from "react";
import { useMutation, type UseMutationState } from "@/hooks/useMutation";

export interface UseTeacherMutationState extends Omit<UseMutationState, "run"> {
  /**
   * Runs `fn` and automatically calls `router.refresh()` on success. Errors
   * are surfaced via the `error` field, same as {@link useMutation}. Does NOT
   * log operation inputs to avoid leaking private user content.
   */
  execute: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * @deprecated Use {@link useMutation} directly with the `refreshOnSuccess`
 * option instead:
 *
 * ```tsx
 * const { busy, error, run } = useMutation("Failed to create classroom");
 * await run(async () => { await postJson("/api/classrooms", { orgId, name }); },
 *           { refreshOnSuccess: true });
 * ```
 *
 * Retained as a thin compatibility shim over the unified mutation leaf so any
 * remaining callers keep working; all in-repo teacher forms have migrated to
 * {@link useMutation}.
 */
export function useTeacherMutation(
  fallbackMessage = "Something went wrong",
): UseTeacherMutationState {
  const { busy, error, setError, clearError, run } = useMutation(fallbackMessage);

  const execute = useCallback(
    <T>(fn: () => Promise<T>): Promise<T | undefined> =>
      run(fn, { refreshOnSuccess: true }),
    [run],
  );

  return { busy, error, setError, clearError, execute };
}
