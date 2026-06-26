/**
 * Content source governance + provider health (Epic RW-E009 — RW-046 / RW-050).
 *
 * Provider EXTRACTION logic stays in code (`src/lib/scraper/providers.ts`). This
 * module owns the OPERATIONAL state for each registered provider, persisted in
 * the `ContentSource` table: whether it is enabled, its crawl policy, the health
 * derived from recent crawls, and cumulative ingestion-quality counters used to
 * flag drift (repeated zero-discovery / high-failure runs).
 *
 *   - {@link syncContentSources} seeds/refreshes one row per code-registry
 *     provider WITHOUT clobbering an operator's enable/disable toggle.
 *   - {@link isProviderEnabled} is the gate the scraper consults before crawling
 *     (an unsynced provider defaults to enabled — graceful).
 *   - {@link recordCrawlRun} folds a crawl's outcome into the counters + health.
 *   - {@link computeHealthStatus} / {@link applyCrawlOutcome} are PURE and unit
 *     tested without a DB.
 */
import { prisma } from "@/lib/prisma";
import { PROVIDERS } from "@/lib/scraper/providers";
import { createLogger } from "@/lib/observability/logger";
import { recordIngestionRun } from "@/lib/metrics";

const log = createLogger("content-sources");

/** Health buckets surfaced in the admin UI. */
export type SourceHealthStatus = "healthy" | "degraded" | "failing" | "unknown";

/** Thresholds for the (pure) health computation. */
export const HEALTH_THRESHOLDS = {
  /** Consecutive failing runs that flip a source to `failing`. */
  failingFailures: 3,
  /** Consecutive zero-discovery runs that flip a source to `failing`. */
  failingZeroDiscovery: 3,
} as const;

/** The mutable counter state we track per provider. */
export type CrawlCounters = {
  lastError: string | null;
  lastDiscoveryCount: number;
  totalDiscovered: number;
  totalScraped: number;
  totalFailed: number;
  totalDuplicates: number;
  totalRejected: number;
  consecutiveFailures: number;
  consecutiveZeroDiscovery: number;
};

/** A single crawl run's tallies (as reported by the scraper/seeder). */
export type CrawlRunOutcome = {
  discovered: number;
  scraped: number;
  failed: number;
  duplicates: number;
  rejected: number;
  error?: string | null;
};

export type ContentSourceRow = {
  id: string;
  providerKey: string;
  displayName: string;
  baseUrl: string | null;
  enabled: boolean;
  crawlPolicy: unknown;
  healthStatus: string;
  lastError: string | null;
  lastCrawledAt: Date | null;
  lastDiscoveryCount: number;
  totalDiscovered: number;
  totalScraped: number;
  totalFailed: number;
  totalDuplicates: number;
  totalRejected: number;
  consecutiveFailures: number;
  consecutiveZeroDiscovery: number;
  createdAt: Date;
  updatedAt: Date;
};

const ZERO_COUNTERS: CrawlCounters = {
  lastError: null,
  lastDiscoveryCount: 0,
  totalDiscovered: 0,
  totalScraped: 0,
  totalFailed: 0,
  totalDuplicates: 0,
  totalRejected: 0,
  consecutiveFailures: 0,
  consecutiveZeroDiscovery: 0,
};

/**
 * PURE: derives a health bucket from the post-run counters. A source is
 * `failing` after enough consecutive failing OR zero-discovery runs, `degraded`
 * on a single recent failure / zero-discovery / lingering error, else
 * `healthy`. Never returns `unknown` (that is the pre-first-crawl DB default).
 */
export function computeHealthStatus(
  counters: Pick<
    CrawlCounters,
    "lastError" | "consecutiveFailures" | "consecutiveZeroDiscovery"
  >,
): Exclude<SourceHealthStatus, "unknown"> {
  const { consecutiveFailures, consecutiveZeroDiscovery, lastError } = counters;
  if (
    consecutiveFailures >= HEALTH_THRESHOLDS.failingFailures ||
    consecutiveZeroDiscovery >= HEALTH_THRESHOLDS.failingZeroDiscovery
  ) {
    return "failing";
  }
  if (consecutiveFailures >= 1 || consecutiveZeroDiscovery >= 1 || lastError) {
    return "degraded";
  }
  return "healthy";
}

/** True when a run produced no successfully-saved articles despite trying. */
function runIsFailure(outcome: CrawlRunOutcome): boolean {
  if (outcome.error) return true;
  return outcome.discovered > 0 && outcome.scraped === 0;
}

/**
 * PURE: folds a crawl run's outcome into the running counters and recomputes
 * health. Used by {@link recordCrawlRun} and unit tested directly.
 */
export function applyCrawlOutcome(
  prev: CrawlCounters,
  outcome: CrawlRunOutcome,
): CrawlCounters & { healthStatus: Exclude<SourceHealthStatus, "unknown"> } {
  const failure = runIsFailure(outcome);
  const zeroDiscovery = outcome.discovered === 0;

  const next: CrawlCounters = {
    lastError: outcome.error ?? null,
    lastDiscoveryCount: outcome.discovered,
    totalDiscovered: prev.totalDiscovered + outcome.discovered,
    totalScraped: prev.totalScraped + outcome.scraped,
    totalFailed: prev.totalFailed + outcome.failed,
    totalDuplicates: prev.totalDuplicates + outcome.duplicates,
    totalRejected: prev.totalRejected + outcome.rejected,
    consecutiveFailures: failure ? prev.consecutiveFailures + 1 : 0,
    consecutiveZeroDiscovery: zeroDiscovery ? prev.consecutiveZeroDiscovery + 1 : 0,
  };

  return { ...next, healthStatus: computeHealthStatus(next) };
}

/** A health summary for the admin UI: status + a `flagged` bit + reasons. */
export type SourceHealthSummary = {
  status: SourceHealthStatus;
  flagged: boolean;
  reasons: string[];
};

/** Computes the display health summary for a persisted source row. */
export function summarizeSourceHealth(source: {
  healthStatus: string;
  consecutiveFailures: number;
  consecutiveZeroDiscovery: number;
  lastError: string | null;
  lastCrawledAt: Date | null;
}): SourceHealthSummary {
  const reasons: string[] = [];
  if (source.consecutiveFailures >= HEALTH_THRESHOLDS.failingFailures) {
    reasons.push(`${source.consecutiveFailures} consecutive failed runs`);
  } else if (source.consecutiveFailures >= 1) {
    reasons.push(`${source.consecutiveFailures} recent failed run(s)`);
  }
  if (source.consecutiveZeroDiscovery >= HEALTH_THRESHOLDS.failingZeroDiscovery) {
    reasons.push(`${source.consecutiveZeroDiscovery} consecutive runs found no articles`);
  } else if (source.consecutiveZeroDiscovery >= 1) {
    reasons.push(`${source.consecutiveZeroDiscovery} recent run(s) found no articles`);
  }
  if (source.lastError) reasons.push(`last error: ${source.lastError}`);

  const status = (source.healthStatus as SourceHealthStatus) ?? "unknown";
  const flagged = status === "failing";
  return { status, flagged, reasons };
}

/** Derives a stable base URL for a provider from its first seed's origin. */
function baseUrlForProvider(seeds: readonly string[]): string | null {
  for (const seed of seeds) {
    try {
      return new URL(seed).origin;
    } catch {
      continue;
    }
  }
  return null;
}

export type SyncContentSourcesResult = {
  created: number;
  updated: number;
  total: number;
};

/**
 * Upserts one ContentSource row per code-registry provider. New rows start
 * `enabled` with `unknown` health; existing rows keep their operator-managed
 * `enabled`/`crawlPolicy`/counters — only `displayName`/`baseUrl` are refreshed.
 */
export async function syncContentSources(): Promise<SyncContentSourcesResult> {
  let created = 0;
  let updated = 0;

  for (const provider of PROVIDERS) {
    const baseUrl = baseUrlForProvider(provider.seeds);
    const existing = await prisma.contentSource.findUnique({
      where: { providerKey: provider.key },
      select: { id: true },
    });
    if (existing) {
      await prisma.contentSource.update({
        where: { providerKey: provider.key },
        data: { displayName: provider.name, baseUrl },
      });
      updated += 1;
    } else {
      await prisma.contentSource.create({
        data: {
          providerKey: provider.key,
          displayName: provider.name,
          baseUrl,
        },
      });
      created += 1;
    }
  }

  log.info("content_sources.sync", { created, updated, total: PROVIDERS.length });
  return { created, updated, total: PROVIDERS.length };
}

/** Lists every persisted content source, ordered by display name. */
export async function listContentSources(): Promise<ContentSourceRow[]> {
  return prisma.contentSource.findMany({ orderBy: { displayName: "asc" } });
}

/** Fetches a single content source by its provider key, or null. */
export async function getContentSource(
  providerKey: string,
): Promise<ContentSourceRow | null> {
  return prisma.contentSource.findUnique({ where: { providerKey } });
}

/**
 * The gate the scraper consults before crawling a provider. An UNSYNCED
 * provider (no row yet) defaults to enabled so discovery keeps working before
 * the first {@link syncContentSources}; a synced row honors its `enabled` flag.
 */
export async function isProviderEnabled(providerKey: string): Promise<boolean> {
  const source = await prisma.contentSource.findUnique({
    where: { providerKey },
    select: { enabled: true },
  });
  return source ? source.enabled : true;
}

/**
 * Enables/disables a content source. Returns the updated row, or null when the
 * provider has no row yet (the admin UI only toggles synced rows).
 */
export async function setContentSourceEnabled(
  providerKey: string,
  enabled: boolean,
): Promise<ContentSourceRow | null> {
  const existing = await prisma.contentSource.findUnique({
    where: { providerKey },
    select: { id: true },
  });
  if (!existing) return null;
  return prisma.contentSource.update({
    where: { providerKey },
    data: { enabled },
  });
}

function coarseOutcome(outcome: CrawlRunOutcome): "success" | "empty" | "failed" {
  if (runIsFailure(outcome)) return "failed";
  if (outcome.scraped === 0) return "empty";
  return "success";
}

/**
 * Folds one crawl run's outcome into a provider's persisted counters + health,
 * upserting the row (so health recording is robust even before an explicit
 * sync) and emitting an ingestion metric. Never throws on a missing row.
 */
export async function recordCrawlRun(
  providerKey: string,
  outcome: CrawlRunOutcome,
  at: Date = new Date(),
): Promise<ContentSourceRow> {
  const existing = await prisma.contentSource.findUnique({
    where: { providerKey },
  });

  const prevCounters: CrawlCounters = existing
    ? {
        lastError: existing.lastError,
        lastDiscoveryCount: existing.lastDiscoveryCount,
        totalDiscovered: existing.totalDiscovered,
        totalScraped: existing.totalScraped,
        totalFailed: existing.totalFailed,
        totalDuplicates: existing.totalDuplicates,
        totalRejected: existing.totalRejected,
        consecutiveFailures: existing.consecutiveFailures,
        consecutiveZeroDiscovery: existing.consecutiveZeroDiscovery,
      }
    : { ...ZERO_COUNTERS };

  const folded = applyCrawlOutcome(prevCounters, outcome);
  const { healthStatus, ...counters } = folded;

  const row = await prisma.contentSource.upsert({
    where: { providerKey },
    update: {
      ...counters,
      healthStatus,
      lastCrawledAt: at,
    },
    create: {
      providerKey,
      displayName: existing?.displayName ?? providerKey,
      ...counters,
      healthStatus,
      lastCrawledAt: at,
    },
  });

  recordIngestionRun({
    provider: providerKey,
    outcome: coarseOutcome(outcome),
    health: healthStatus,
  });

  return row;
}
