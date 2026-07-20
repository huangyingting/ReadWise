"use client";

import { useCallback, useState } from "react";

import { Badge, EmptyState, Select, Skeleton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { AdminTableWrap } from "@/components/admin";
import { getJson } from "@/lib/client-fetch";
import { formatDateTime } from "@/lib/display-format";
import {
  classifyAdminFetchError,
  type AdminFetchErrorState,
} from "@/lib/admin/admin-fetch-state";
import {
  crawlRunsEndpoint,
  distinctOutcomes,
  filterByOutcome,
  formatCrawlDuration,
  type CrawlRunHistoryRowView,
  type CrawlRunsResponse,
} from "@/lib/admin/sources/crawl-history-ui";

const DASH = "—";

type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; runs: CrawlRunHistoryRowView[] }
  | { status: "error"; error: AdminFetchErrorState };

function outcomeBadgeVariant(outcome: string): BadgeVariant {
  const value = outcome.toLowerCase();
  if (value.includes("success") || value === "ok") return "success";
  if (value.includes("fail") || value.includes("error")) return "danger";
  if (value.includes("partial") || value.includes("empty") || value.includes("skip")) {
    return "warning";
  }
  return "neutral";
}

function loadErrorMessage(error: AdminFetchErrorState): string {
  switch (error.kind) {
    case "forbidden":
      return "You don't have access to view crawl history.";
    case "unauthorized":
      return "Your session has expired. Sign in again to continue.";
    case "notFound":
      return "This content source could not be found.";
    default:
      return error.message;
  }
}

/**
 * Crawl-run history island (#1153). Renders a "View history" trigger that opens
 * a Sheet and fetches fuller crawl-run history for a provider from
 * `GET /api/admin/sources/[key]/crawl-runs` (the Sources page keeps its inline
 * 3-run summary). Read-only — a plain `getJson` + local state, no mutation.
 *
 * Every column is privacy-safe (outcome / timestamp / source+mode / duration /
 * counts / controlled error string) — the endpoint returns no URLs, article
 * text, or user-private content. Composed only from `@/components/ui` +
 * `@/components/admin` primitives; token-driven.
 */
export default function AdminSourceCrawlHistory({
  providerKey,
  displayName,
}: {
  providerKey: string;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [outcome, setOutcome] = useState("");

  const loadRuns = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await getJson<CrawlRunsResponse>(crawlRunsEndpoint(providerKey));
      setLoad({ status: "ready", runs: res.runs });
    } catch (err) {
      setLoad({ status: "error", error: classifyAdminFetchError(err) });
    }
  }, [providerKey]);

  function openSheet() {
    setOutcome("");
    setOpen(true);
    void loadRuns();
  }

  function closeSheet() {
    setOpen(false);
  }

  const runs = load.status === "ready" ? load.runs : [];
  const filtered = filterByOutcome(runs, outcome);
  const outcomes = distinctOutcomes(runs);

  return (
    <>
      <Button size="sm" variant="outline" onClick={openSheet}>
        View history
      </Button>

      <Sheet
        open={open}
        onClose={closeSheet}
        side="right"
        label={`Crawl history: ${displayName}`}
      >
        <div className="flex items-center justify-between border-b border-border px-[var(--space-5)] py-[var(--space-4)]">
          <div>
            <h2 className="m-0 text-[length:var(--text-lg)] font-semibold text-text">
              Crawl history
            </h2>
            <p className="m-0 text-[length:var(--text-sm)] text-text-muted">{displayName}</p>
          </div>
          <Button variant="outline" size="sm" onClick={closeSheet}>
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-[var(--space-4)] overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
          {load.status === "loading" && (
            <div className="flex flex-col gap-[var(--space-2)]" aria-busy="true">
              <span className="sr-only" role="status">
                Loading crawl history
              </span>
              {Array.from({ length: 5 }).map((_, i) => (
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
                onClick={() => void loadRuns()}
              >
                Retry
              </Button>
            </div>
          )}

          {load.status === "ready" && runs.length === 0 && (
            <EmptyState
              title="No recorded runs"
              description="This provider has no recorded crawl runs yet."
            />
          )}

          {load.status === "ready" && runs.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  selectSize="md"
                  className="w-auto"
                  aria-label="Filter by outcome"
                >
                  <option value="">All outcomes</option>
                  {outcomes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
                <p className="muted m-0 text-[length:var(--text-sm)]" role="status" aria-live="polite">
                  {filtered.length} of {runs.length} runs
                </p>
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  title="No matching runs"
                  description="No crawl runs match this outcome filter."
                />
              ) : (
                <CrawlRunsTable runs={filtered} />
              )}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function CrawlRunsTable({ runs }: { runs: CrawlRunHistoryRowView[] }) {
  return (
    <AdminTableWrap ariaLabel="Crawl run history (scrollable)">
      <thead>
        <tr>
          <th scope="col">Outcome</th>
          <th scope="col">When</th>
          <th scope="col">Source / Mode</th>
          <th scope="col">Duration</th>
          <th scope="col">Discovered / Scraped</th>
          <th scope="col">Failed / Dupes / Rejected</th>
          <th scope="col">Error</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              <Badge variant={outcomeBadgeVariant(run.outcome)}>{run.outcome}</Badge>
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {formatDateTime(new Date(run.createdAt))}
            </td>
            <td className="text-text-muted text-[length:var(--text-sm)]">
              {run.source}/{run.mode}
            </td>
            <td className="tabular-nums text-text-muted text-[length:var(--text-sm)]">
              {formatCrawlDuration(run.durationMs)}
            </td>
            <td className="tabular-nums text-text-muted">
              {run.discovered} / {run.scraped}
            </td>
            <td className="tabular-nums text-text-muted">
              {run.failed} / {run.duplicates} / {run.rejected}
            </td>
            <td className="text-danger-text text-[length:var(--text-sm)]">
              {run.error ? (
                <span className="block max-w-[24ch] truncate" title={run.error}>
                  {run.error}
                </span>
              ) : (
                <span className="text-text-muted">{DASH}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </AdminTableWrap>
  );
}
