/**
 * PURE, client-safe helpers for the admin series-reorder island (issue #1144).
 *
 * Owns the presentation contract for wiring the existing
 * `POST /api/admin/series/[id]/reorder` endpoint into the admin Series UI
 * WITHOUT any React/DOM/network: the endpoint builders, the two pure
 * array-reorder helpers the island's local state uses, and the response DTO.
 *
 * ID-based by design: series `articleIds` are NOT foreign keys — they are
 * revalidated per access-context and there is no cheap title lookup — so the UI
 * only ever reads `id` + `articleIds`. The DTO is single-sourced from the
 * engagement module via `import type` (erased at runtime, so no Prisma runtime
 * is pulled into the browser bundle) and narrowed with `Pick` to exactly those
 * two fields (privacy by construction).
 */
import type { AdminSeriesDetail } from "@/lib/engagement/series";

/** The only fields the reorder UI reads back from the detail/reorder routes. */
export type SeriesReorderDetail = Pick<AdminSeriesDetail, "id" | "articleIds">;

/** The `{ ok, series }` body returned by the reorder route. */
export interface ReorderResponse {
  ok: boolean;
  series: SeriesReorderDetail;
}

/** The admin single-series detail endpoint (current ordered `articleIds`). */
export function seriesDetailEndpoint(id: string): string {
  return `/api/admin/series/${id}`;
}

/** The admin series-reorder endpoint (POST `{ articleIds }`). */
export function seriesReorderEndpoint(id: string): string {
  return `/api/admin/series/${id}/reorder`;
}

/**
 * Returns a NEW array with the item at `index` swapped one slot up or down.
 * Out-of-bounds moves (index 0 + "up", last + "down", or an invalid index)
 * return an unchanged COPY. The input is never mutated. PURE.
 */
export function moveArticleId(
  ids: readonly string[],
  index: number,
  dir: "up" | "down",
): string[] {
  const next = ids.slice();
  const target = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  const tmp = next[index]!;
  next[index] = next[target]!;
  next[target] = tmp;
  return next;
}

/** Length + element-wise equality of two id orders. PURE. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
