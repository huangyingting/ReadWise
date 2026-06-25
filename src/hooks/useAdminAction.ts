"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
 */
export function useAdminAction<K extends string = string>() {
  const router = useRouter();
  const [busy, setBusy] = useState<K | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<K | null>(null);

  async function run(
    key: K,
    fn: () => Promise<void>,
    opts?: { errorFallback?: string; skipRefresh?: boolean },
  ) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      if (!opts?.skipRefresh) {
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (opts?.errorFallback ?? `${key} failed`),
      );
    } finally {
      setBusy(null);
    }
  }

  return { busy, setBusy, error, setError, openPanel, setOpenPanel, run, router };
}
