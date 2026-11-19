"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getJson } from "@/lib/client-fetch";
import { classifyAdminFetchError, type AdminFetchErrorState } from "@/lib/admin/admin-fetch-state";

export type AdminQueueState<P> =
  | { status: "loading" }
  | { status: "error"; error: AdminFetchErrorState }
  | { status: "ready"; page: P };

/**
 * Filter + fetch state for a paginated admin review queue. Filters are mirrored
 * into the URL (`router.replace`, no scroll) so a reload or shared link restores
 * the same view; every filter change refetches `endpoint?{buildQuery(filters)}`.
 *
 * `buildQuery` and `onLoaded` must be stable (module-level or memoized).
 */
export function useAdminQueue<F extends { offset: number }, P>({
  endpoint,
  initialFilters,
  buildQuery,
  onLoaded,
}: {
  endpoint: string;
  initialFilters: F;
  buildQuery: (filters: F) => string;
  /** Called after each successful load (e.g. to clear a row selection). */
  onLoaded?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<F>(initialFilters);
  const [data, setData] = useState<AdminQueueState<P>>({ status: "loading" });

  const load = useCallback(
    async (f: F) => {
      setData({ status: "loading" });
      try {
        const page = await getJson<P>(`${endpoint}?${buildQuery(f)}`);
        setData({ status: "ready", page });
        onLoaded?.();
      } catch (err) {
        setData({ status: "error", error: classifyAdminFetchError(err) });
      }
    },
    [endpoint, buildQuery, onLoaded],
  );

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const applyFilters = useCallback(
    (next: F) => {
      setFilters(next);
      router.replace(`${pathname}?${buildQuery(next)}`, { scroll: false });
    },
    [buildQuery, pathname, router],
  );

  const goToOffset = (offset: number) => applyFilters({ ...filters, offset });

  return { filters, data, load, applyFilters, goToOffset };
}
