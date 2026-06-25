"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
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
 * Shared teacher-form mutation primitive. Wraps {@link useMutation} with an
 * automatic `router.refresh()` call on success so teacher forms don't need to
 * import `useRouter` and call `router.refresh()` individually.
 *
 * Usage:
 * ```tsx
 * const { busy, error, execute } = useTeacherMutation("Failed to create classroom");
 * await execute(async () => {
 *   await postJson("/api/classrooms", { orgId, name });
 *   resetFields();
 * });
 * ```
 */
export function useTeacherMutation(
  fallbackMessage = "Something went wrong",
): UseTeacherMutationState {
  const router = useRouter();
  const { busy, error, clearError, run } = useMutation(fallbackMessage);

  const execute = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      return run(async () => {
        const result = await fn();
        router.refresh();
        return result;
      });
    },
    [run, router],
  );

  return { busy, error, clearError, execute };
}
