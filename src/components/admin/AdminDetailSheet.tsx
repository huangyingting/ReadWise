"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Skeleton, Spinner } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";

export type AdminDetailState<T> =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; detail: T };

/**
 * Loads one admin detail record whenever `id` changes. `fetchDetail` must be
 * stable (module-level or memoized).
 */
export function useAdminDetail<T>(id: string | null, fetchDetail: (id: string) => Promise<T>) {
  const [state, setState] = useState<AdminDetailState<T>>({ status: "loading" });

  const load = useCallback(
    async (target: string) => {
      setState({ status: "loading" });
      try {
        setState({ status: "ready", detail: await fetchDetail(target) });
      } catch (err) {
        setState({ status: "error", error: classifyAdminFetchError(err) });
      }
    },
    [fetchDetail],
  );

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  const reload = useCallback(() => {
    if (id) void load(id);
  }, [id, load]);

  return { state, reload };
}

/** One label/value pair inside a detail `<dl>`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <dt className="text-text-muted text-[length:var(--text-xs)]">{label}</dt>
      <dd className="m-0 text-[length:var(--text-sm)] break-words">{children}</dd>
    </div>
  );
}

/**
 * Right-side drawer for one admin record: title + Close header, then the
 * loading skeleton, a deny-aware error with Retry, or `children(detail)`.
 * `noun` names the record in the state copy ("Loading candidate details").
 */
export function AdminDetailSheet<T>({
  open,
  onClose,
  label,
  title,
  noun,
  state,
  onRetry,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  title: string;
  noun: string;
  state: AdminDetailState<T>;
  onRetry: () => void;
  children: (detail: T) => ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} side="right" label={label}>
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
        <h2 className="m-0 text-[length:var(--type-section-title)] font-[family-name:var(--font-display)] font-semibold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close details">
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {state.status === "loading" && (
          <div className="flex flex-col gap-[var(--space-3)]" aria-busy="true">
            <span className="sr-only" role="status">
              <Spinner size="sm" /> Loading {noun} details
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[var(--space-6)] w-full" />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <p role="alert" className="m-0 text-danger-text text-[length:var(--text-sm)]">
              {state.error.kind === "forbidden"
                ? `You don't have access to view this ${noun}.`
                : state.error.kind === "notFound"
                  ? `This ${noun} no longer exists.`
                  : `Couldn't load ${noun} details.`}
            </p>
            {state.error.kind !== "forbidden" && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}

        {state.status === "ready" && children(state.detail)}
      </div>
    </Sheet>
  );
}
