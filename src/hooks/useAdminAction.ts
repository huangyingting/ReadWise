"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@/hooks/useMutation";

/**
 * Shared state + action runner for admin action components.
 *
 * The generic parameter `K` should be a string union of all action keys the
 * component supports (e.g. `"retry" | "cancel" | "archive"`). This gives
 * typed `busy` and `openPanel` values without per-component boilerplate.
 *
 * Usage:
 * ```tsx
 * const { busy, error, openPanel, setOpenPanel, run } =
 *   useAdminAction<"retry" | "cancel">();
 *
 * // inside an onClick / onConfirm:
 * await run("retry", () => postJson(`/api/admin/jobs/${id}`, { action: "retry" }));
 * ```
 *
 * `run` sets `busy` to the key while the promise is in-flight, clears `error`
 * before each attempt, sets `error` on failure, and calls `router.refresh()`
 * on success (pass `skipRefresh: true` to opt out — e.g. when the action
 * navigates away).
 *
 * The error/refresh handling delegates to the unified {@link useMutation} leaf;
 * this hook only adds the keyed `busy`/`openPanel` ergonomics on top.
 */
export function useAdminAction<K extends string = string>() {
  const router = useRouter();
  const { error, setError, run: runMutation } = useMutation();
  const [busy, setBusy] = useState<K | null>(null);
  const [openPanel, setOpenPanel] = useState<K | null>(null);

  const run = useCallback(
    async (
      key: K,
      fn: () => Promise<void>,
      opts?: { errorFallback?: string; skipRefresh?: boolean },
    ) => {
      setBusy(key);
      await runMutation(fn, {
        refreshOnSuccess: !opts?.skipRefresh,
        fallbackMessage: opts?.errorFallback ?? `${key} failed`,
      });
      setBusy(null);
    },
    [runMutation],
  );

  return { busy, setBusy, error, setError, openPanel, setOpenPanel, run, router };
}
