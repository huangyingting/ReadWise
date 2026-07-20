/**
 * PURE, client-safe helpers for the admin crawl-run history island (issue #1153).
 *
 * Owns the presentation contract for wiring the existing
 * `GET /api/admin/sources/[key]/crawl-runs` endpoint into the admin Sources UI
 * WITHOUT any React/DOM/network: the endpoint builder, the client row DTO, the
 * outcome filter helpers, and the duration formatter.
 *
 * The row type is single-sourced from the scraper-sources module via
 * `import type` — that module pulls in the Prisma runtime, so it is imported as
 * a TYPE ONLY (erased at build, never bundled into the browser). The numeric
 * limit is a LOCAL literal here (not the runtime const) for the same reason.
 * Every field the endpoint returns is privacy-safe (ids / enums / counts /
 * durations / timestamps) — no URLs, article text, or user-private content.
 */
import type { CrawlRunHistoryRow } from "@/lib/scraper/sources";

/** Max rows the history island requests (mirrors the route's API max, kept local). */
export const CRAWL_HISTORY_UI_LIMIT = 50;

/**
 * A single crawl-run history row as rendered by the island. `createdAt` arrives
 * as an ISO string over the JSON API (the backend row types it as `Date`).
 */
export type CrawlRunHistoryRowView = Omit<CrawlRunHistoryRow, "createdAt"> & {
  createdAt: string;
};

/** The `{ ok, providerKey, runs }` response body of the crawl-runs route. */
export interface CrawlRunsResponse {
  ok: boolean;
  providerKey: string;
  runs: CrawlRunHistoryRowView[];
}

/** The crawl-runs endpoint for a provider key (limit defaults to the UI max). */
export function crawlRunsEndpoint(
  providerKey: string,
  limit: number = CRAWL_HISTORY_UI_LIMIT,
): string {
  return `/api/admin/sources/${encodeURIComponent(providerKey)}/crawl-runs?limit=${limit}`;
}

/** Unique outcomes in first-seen order (for the filter Select options). PURE. */
export function distinctOutcomes(runs: readonly CrawlRunHistoryRowView[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const run of runs) {
    if (!seen.has(run.outcome)) {
      seen.add(run.outcome);
      out.push(run.outcome);
    }
  }
  return out;
}

/**
 * Filters runs by outcome. `outcome === ""` is the "All" sentinel and returns a
 * copy of every run; otherwise only the runs whose outcome matches. Never
 * mutates the input. PURE.
 */
export function filterByOutcome(
  runs: readonly CrawlRunHistoryRowView[],
  outcome: string,
): CrawlRunHistoryRowView[] {
  if (outcome === "") return runs.slice();
  return runs.filter((run) => run.outcome === outcome);
}

/**
 * Formats a crawl duration for display (mirrors the Sources page's helper):
 * null → "duration unknown"; <1000ms → `${ms}ms`; else `${(ms/1000).toFixed(1)}s`.
 * PURE.
 */
export function formatCrawlDuration(durationMs: number | null): string {
  if (durationMs == null) return "duration unknown";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
