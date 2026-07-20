"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { getJson, postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import {
  classifyAdminFetchError,
  type AdminFetchErrorState,
} from "@/lib/admin/admin-fetch-state";
import {
  moveArticleId,
  sameOrder,
  seriesDetailEndpoint,
  seriesReorderEndpoint,
  type ReorderResponse,
  type SeriesReorderDetail,
} from "@/lib/admin/series/reorder-ui";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: AdminFetchErrorState };

function loadErrorMessage(error: AdminFetchErrorState): string {
  switch (error.kind) {
    case "forbidden":
      return "You don't have access to reorder this series.";
    case "unauthorized":
      return "Your session has expired. Sign in again to continue.";
    case "notFound":
      return "This series could not be found.";
    default:
      return error.message;
  }
}

/**
 * Series article-reorder island (#1144). Renders a single "Reorder" trigger
 * that opens a Sheet, fetches the CURRENT ordered `articleIds` for the series
 * from `GET /api/admin/series/[id]`, and lets an operator move articles up/down
 * before saving the new order via `POST /api/admin/series/[id]/reorder`.
 *
 * ID-based by design (article ids are not foreign keys and have no cheap title
 * lookup): each row shows a 1-based position + the opaque, truncated id (full id
 * in a `title`). Save is disabled when the order is unchanged (mirrors the
 * backend's unchanged early-return) and refreshes the page on success. Composed
 * only from `@/components/ui` primitives; token-driven.
 */
export default function AdminSeriesReorder({
  seriesId,
  title,
}: {
  seriesId: string;
  title: string;
}) {
  const router = useRouter();
  const { busy, error, run, clearError } = useMutation("Failed to reorder series");
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [fetched, setFetched] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);

  const loadOrder = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await getJson<{ series: SeriesReorderDetail }>(
        seriesDetailEndpoint(seriesId),
      );
      const ids = res.series.articleIds;
      setFetched(ids);
      setOrder(ids);
      setLoad({ status: "ready" });
    } catch (err) {
      setLoad({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, [seriesId]);

  function openSheet() {
    clearError();
    setOpen(true);
    void loadOrder();
  }

  function closeSheet() {
    setOpen(false);
  }

  function move(index: number, dir: "up" | "down") {
    setOrder((prev) => moveArticleId(prev, index, dir));
  }

  function reset() {
    setOrder(fetched);
  }

  const dirty = !sameOrder(order, fetched);

  async function save() {
    const result = await run(() =>
      postJson<ReorderResponse>(seriesReorderEndpoint(seriesId), {
        articleIds: order,
      }),
    );
    if (result !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={openSheet} disabled={busy}>
        Reorder
      </Button>

      <Sheet
        open={open}
        onClose={closeSheet}
        side="right"
        label={`Reorder articles: ${title}`}
      >
        <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
            Reorder articles
          </h2>
          <Button variant="outline" size="sm" onClick={closeSheet}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
          {load.status === "loading" && (
            <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true">
              <span className="sr-only" role="status">
                Loading series order
              </span>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[var(--space-8)] w-full" />
              ))}
            </div>
          )}

          {load.status === "error" && (
            <div className="stack" role="alert">
              <p className="m-0 text-[length:var(--text-sm)] text-danger-text">
                {loadErrorMessage(load.error)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-auto"
                onClick={() => void loadOrder()}
              >
                Retry
              </Button>
            </div>
          )}

          {load.status === "ready" && fetched.length < 2 && (
            <EmptyState
              title="Not enough articles"
              description="Add at least two articles to reorder."
            />
          )}

          {load.status === "ready" && fetched.length >= 2 && (
            <>
              <p
                className="muted m-0 text-[length:var(--text-sm)]"
                role="status"
                aria-live="polite"
              >
                {dirty
                  ? "Order changed — Save to apply."
                  : `${order.length} articles · current order`}
              </p>

              <ol className="flex list-none flex-col gap-[var(--space-2)] p-0">
                {order.map((id, index) => (
                  <li
                    key={id}
                    className="flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)]"
                  >
                    <span className="tabular-nums text-text-muted text-[length:var(--text-sm)] min-w-[var(--space-6)]">
                      {index + 1}
                    </span>
                    <code
                      className="flex-1 min-w-0 truncate text-[length:var(--text-xs)] text-text"
                      title={id}
                    >
                      {id}
                    </code>
                    <div className="flex gap-[var(--space-1)]">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === 0 || busy}
                        aria-label={`Move article ${id} up`}
                        onClick={() => move(index, "up")}
                      >
                        Up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={index === order.length - 1 || busy}
                        aria-label={`Move article ${id} down`}
                        onClick={() => move(index, "down")}
                      >
                        Down
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>

              {error && (
                <p
                  className="m-0 text-[length:var(--text-sm)] text-danger-text"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!dirty || busy}
                  onClick={save}
                >
                  Save order
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  disabled={!dirty || busy}
                  onClick={reset}
                >
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  disabled={busy}
                  onClick={closeSheet}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
