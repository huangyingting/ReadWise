"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { EmptyState, Skeleton, Spinner } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { getJson, patchJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import { useFilteredFetch } from "@/hooks/useFilteredFetch";
import {
  classifyAdminFetchError,
  type AdminFetchErrorState,
} from "@/lib/admin/admin-fetch-state";
import { moveArticleId, sameOrder } from "@/lib/admin/series/reorder-ui";
import {
  addArticleId,
  adminArticlesSearchEndpoint,
  removeArticleId,
  seriesManageEndpoint,
  type AdminArticleSearchHit,
  type AdminArticleSearchResponse,
  type SeriesManagerArticle,
  type SeriesManagerDetailResponse,
} from "@/lib/admin/series/manage-ui";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: AdminFetchErrorState };

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "ready"; hits: AdminArticleSearchHit[] }
  | { status: "error"; error: AdminFetchErrorState };

function loadErrorMessage(error: AdminFetchErrorState): string {
  switch (error.kind) {
    case "forbidden":
      return "You don't have access to manage this series.";
    case "unauthorized":
      return "Your session has expired. Sign in again to continue.";
    case "notFound":
      return "This series could not be found.";
    default:
      return error.message;
  }
}

function searchErrorMessage(error: AdminFetchErrorState): string {
  switch (error.kind) {
    case "forbidden":
      return "You don't have access to search articles.";
    case "unauthorized":
      return "Your session has expired. Sign in again to continue.";
    default:
      return error.message;
  }
}

/**
 * Series article-manager island (#1157). A single "Manage articles" trigger
 * opens a Sheet that lets an operator populate a series end-to-end: it fetches
 * the CURRENT ordered `articleIds` plus RESOLVED titles from
 * `GET /api/admin/series/[id]`, lists members with titles (order preserved),
 * removes members, searches `GET /api/admin/articles?q=…` (debounced) to ADD
 * articles not already present, and reorders up/down — then persists the
 * resulting ordered `articleIds` via `PATCH /api/admin/series/[id]` and
 * refreshes. Supersedes the old ID-only reorder island (#1144).
 *
 * Orphaned ids (article deleted after being added — ids are NOT foreign keys)
 * are kept in the working order and shown as a muted "Unknown article" row so
 * the operator can see and remove them; they are never silently dropped.
 * Composed only from `@/components/ui` primitives; token-driven.
 */
export default function AdminSeriesArticleManager({
  seriesId,
  title,
}: {
  seriesId: string;
  title: string;
}) {
  const router = useRouter();
  const { busy, error, run, clearError } = useMutation("Failed to update series articles");
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [initial, setInitial] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [titleById, setTitleById] = useState<Map<string, SeriesManagerArticle>>(new Map());
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const searchFetch = useFilteredFetch<AdminArticleSearchResponse>(250);

  const memberSet = useMemo(() => new Set(order), [order]);

  const loadDetail = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await getJson<SeriesManagerDetailResponse>(
        seriesManageEndpoint(seriesId),
      );
      const ids = res.series.articleIds;
      setInitial(ids);
      setOrder(ids);
      setTitleById(new Map(res.series.articles.map((a) => [a.id, a])));
      setLoad({ status: "ready" });
    } catch (err) {
      setLoad({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, [seriesId]);

  const runSearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        searchFetch.cancel();
        setSearch({ status: "idle" });
        return;
      }
      setSearch({ status: "searching" });
      searchFetch.run({
        fetcher: (signal) =>
          getJson<AdminArticleSearchResponse>(adminArticlesSearchEndpoint(trimmed), {
            signal,
          }),
        onResult: (data) => setSearch({ status: "ready", hits: data.articles }),
        onError: (err) =>
          setSearch({ status: "error", error: classifyAdminFetchError(err) }),
      });
    },
    [searchFetch],
  );

  function openSheet() {
    clearError();
    setQuery("");
    setSearch({ status: "idle" });
    setOpen(true);
    void loadDetail();
  }

  function closeSheet() {
    searchFetch.cancel();
    setOpen(false);
  }

  function onQueryChange(value: string) {
    setQuery(value);
    runSearch(value);
  }

  function add(id: string) {
    setOrder((prev) => addArticleId(prev, id));
  }

  function remove(id: string) {
    setOrder((prev) => removeArticleId(prev, id));
  }

  function move(index: number, dir: "up" | "down") {
    setOrder((prev) => moveArticleId(prev, index, dir));
  }

  function reset() {
    setOrder(initial);
  }

  function labelFor(id: string): { title: string; slug: string | null; orphan: boolean } {
    const known = titleById.get(id);
    if (known) return { title: known.title, slug: known.slug, orphan: false };
    return { title: "Unknown article", slug: null, orphan: true };
  }

  const dirty = !sameOrder(order, initial);

  async function save() {
    const result = await run(() =>
      patchJson(seriesManageEndpoint(seriesId), { articleIds: order }),
    );
    if (result !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  const searchHits =
    search.status === "ready"
      ? search.hits.filter((hit) => !memberSet.has(hit.id))
      : [];

  return (
    <>
      <Button size="sm" variant="outline" onClick={openSheet} disabled={busy}>
        Manage articles
      </Button>

      <Sheet
        open={open}
        onClose={closeSheet}
        side="right"
        label={`Manage articles: ${title}`}
      >
        <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
            Manage articles
          </h2>
          <Button variant="outline" size="sm" onClick={closeSheet}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-[var(--space-5)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
          {load.status === "loading" && (
            <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true">
              <span className="sr-only" role="status">
                Loading series articles
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
                onClick={() => void loadDetail()}
              >
                Retry
              </Button>
            </div>
          )}

          {load.status === "ready" && (
            <>
              <section className="flex flex-col gap-[var(--space-3)]">
                <h3 className="m-0 text-[length:var(--text-sm)] font-semibold text-text">
                  In this series
                </h3>
                {order.length === 0 ? (
                  <EmptyState
                    title="No articles yet"
                    description="Search below to add the first article to this series."
                    titleAs="p"
                  />
                ) : (
                  <ol className="flex list-none flex-col gap-[var(--space-2)] p-0">
                    {order.map((id, index) => {
                      const info = labelFor(id);
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)]"
                        >
                          <span className="tabular-nums text-text-muted text-[length:var(--text-sm)] min-w-[var(--space-6)]">
                            {index + 1}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span
                              className={
                                info.orphan
                                  ? "truncate text-[length:var(--text-sm)] italic text-text-muted"
                                  : "truncate text-[length:var(--text-sm)] text-text"
                              }
                              title={info.title}
                            >
                              {info.title}
                            </span>
                            <span
                              className="truncate text-[length:var(--text-xs)] text-text-subtle font-mono"
                              title={id}
                            >
                              {info.orphan ? `orphaned · ${id}` : (info.slug ?? id)}
                            </span>
                          </div>
                          <div className="flex gap-[var(--space-1)]">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === 0 || busy}
                              aria-label={`Move ${info.title} up`}
                              onClick={() => move(index, "up")}
                            >
                              Up
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={index === order.length - 1 || busy}
                              aria-label={`Move ${info.title} down`}
                              onClick={() => move(index, "down")}
                            >
                              Down
                            </Button>
                            <Button
                              size="sm"
                              variant="danger-ghost"
                              disabled={busy}
                              aria-label={`Remove ${info.title} from series`}
                              onClick={() => remove(id)}
                            >
                              Remove
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section className="flex flex-col gap-[var(--space-3)]">
                <h3 className="m-0 text-[length:var(--text-sm)] font-semibold text-text">
                  Add articles
                </h3>
                <Field label="Search articles" hint="Search by title, author, or source">
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Search articles to add…"
                    inputSize="md"
                    autoComplete="off"
                  />
                </Field>

                {search.status === "searching" && (
                  <div
                    className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-text-muted"
                    aria-busy="true"
                  >
                    <Spinner size="sm" />
                    <span role="status">Searching…</span>
                  </div>
                )}

                {search.status === "error" && (
                  <p
                    className="m-0 text-[length:var(--text-sm)] text-danger-text"
                    role="alert"
                  >
                    {searchErrorMessage(search.error)}
                  </p>
                )}

                {search.status === "ready" && searchHits.length === 0 && (
                  <EmptyState
                    title="No matching articles"
                    description="No articles match your search, or every match is already in this series."
                    titleAs="p"
                  />
                )}

                {search.status === "ready" && searchHits.length > 0 && (
                  <ul className="flex list-none flex-col gap-[var(--space-2)] p-0">
                    {searchHits.map((hit) => (
                      <li
                        key={hit.id}
                        className="flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-border px-[var(--space-3)] py-[var(--space-2)]"
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span
                            className="truncate text-[length:var(--text-sm)] text-text"
                            title={hit.title}
                          >
                            {hit.title}
                          </span>
                          <span
                            className="truncate text-[length:var(--text-xs)] text-text-subtle font-mono"
                            title={hit.id}
                          >
                            {hit.id}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          aria-label={`Add ${hit.title} to series`}
                          onClick={() => add(hit.id)}
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p
                className="muted m-0 text-[length:var(--text-sm)]"
                role="status"
                aria-live="polite"
              >
                {dirty
                  ? "Membership changed — Save to apply."
                  : `${order.length} ${order.length === 1 ? "article" : "articles"} · saved`}
              </p>

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
                  Save changes
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
