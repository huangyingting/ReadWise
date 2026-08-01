import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

type SourceRow = {
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

type CrawlRunRow = {
  id: string;
  providerKey: string;
  source: string;
  mode: string;
  outcome: string;
  durationMs: number | null;
  discovered: number;
  scraped: number;
  failed: number;
  duplicates: number;
  rejected: number;
  error: string | null;
  createdAt: Date;
};

let sources: Map<string, SourceRow>;
let crawlRuns: CrawlRunRow[];
let seq = 0;
let crawlSeq = 0;

function blankRow(providerKey: string, data: Partial<SourceRow> = {}): SourceRow {
  const now = new Date("2026-06-23T00:00:00Z");
  return {
    id: `cs-${++seq}`,
    providerKey,
    displayName: providerKey,
    baseUrl: null,
    enabled: true,
    crawlPolicy: null,
    healthStatus: "unknown",
    lastError: null,
    lastCrawledAt: null,
    lastDiscoveryCount: 0,
    totalDiscovered: 0,
    totalScraped: 0,
    totalFailed: 0,
    totalDuplicates: 0,
    totalRejected: 0,
    consecutiveFailures: 0,
    consecutiveZeroDiscovery: 0,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
}

function emptyCrawlState() {
  return {
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
}

function failedDiscoveryOutcome(error = "boom") {
  return {
    discovered: 0,
    scraped: 0,
    failed: 0,
    duplicates: 0,
    rejected: 0,
    error,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        contentSource: {
          findUnique: async (a: { where: { providerKey: string }; select?: Record<string, boolean> }) => {
            const row = sources.get(a.where.providerKey) ?? null;
            if (!row || !a.select) return row;
            return Object.fromEntries(
              Object.entries(a.select)
                .filter(([, v]) => v)
                .map(([k]) => [k, (row as unknown as Record<string, unknown>)[k]]),
            );
          },
          findMany: async () =>
            [...sources.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
          create: async (a: { data: Partial<SourceRow> & { providerKey: string } }) => {
            const row = blankRow(a.data.providerKey, a.data);
            sources.set(row.providerKey, row);
            return row;
          },
          update: async (a: { where: { providerKey: string }; data: Partial<SourceRow> }) => {
            const row = sources.get(a.where.providerKey);
            if (!row) throw new Error("not found");
            Object.assign(row, a.data);
            return row;
          },
          upsert: async (a: {
            where: { providerKey: string };
            create: Partial<SourceRow> & { providerKey: string };
            update: Partial<SourceRow>;
          }) => {
            const existing = sources.get(a.where.providerKey);
            if (existing) {
              Object.assign(existing, a.update);
              return existing;
            }
            const row = blankRow(a.where.providerKey, a.create);
            sources.set(row.providerKey, row);
            return row;
          },
        },
        crawlRun: {
          create: async (a: { data: Omit<CrawlRunRow, "id"> }) => {
            const row = { id: `run-${++crawlSeq}`, ...a.data };
            crawlRuns.push(row);
            return row;
          },
          findMany: async (a: {
            where: { providerKey: string };
            orderBy?: { createdAt: "desc" | "asc" };
            skip?: number;
            take?: number;
            select?: { id?: boolean };
          }) => {
            let rows = crawlRuns.filter((row) => row.providerKey === a.where.providerKey);
            rows = rows.sort((left, right) =>
              a.orderBy?.createdAt === "asc"
                ? left.createdAt.getTime() - right.createdAt.getTime()
                : right.createdAt.getTime() - left.createdAt.getTime(),
            );
            rows = rows.slice(a.skip ?? 0, a.take == null ? undefined : (a.skip ?? 0) + a.take);
            if (a.select?.id) return rows.map((row) => ({ id: row.id }));
            return rows;
          },
          deleteMany: async (a: { where: { id: { in: string[] } } }) => {
            const ids = new Set(a.where.id.in);
            const before = crawlRuns.length;
            crawlRuns = crawlRuns.filter((row) => !ids.has(row.id));
            return { count: before - crawlRuns.length };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  sources = new Map();
  crawlRuns = [];
  seq = 0;
  crawlSeq = 0;
});

test("computeHealthStatus buckets by consecutive failures and zero-discovery", async () => {
  const { computeHealthStatus } = await import("@/lib/scraper/sources");
  const cases = [
    [{ lastError: null, consecutiveFailures: 0, consecutiveZeroDiscovery: 0 }, "healthy"],
    [{ lastError: "boom", consecutiveFailures: 0, consecutiveZeroDiscovery: 0 }, "degraded"],
    [{ lastError: null, consecutiveFailures: 1, consecutiveZeroDiscovery: 0 }, "degraded"],
    [{ lastError: null, consecutiveFailures: 3, consecutiveZeroDiscovery: 0 }, "failing"],
    [{ lastError: null, consecutiveFailures: 0, consecutiveZeroDiscovery: 3 }, "failing"],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(computeHealthStatus(input), expected);
  }
});

test("applyCrawlOutcome folds counters and resets streaks on a good run", async () => {
  const { applyCrawlOutcome } = await import("@/lib/scraper/sources");
  const start = {
    lastError: "old",
    lastDiscoveryCount: 0,
    totalDiscovered: 5,
    totalScraped: 2,
    totalFailed: 1,
    totalDuplicates: 0,
    totalRejected: 0,
    consecutiveFailures: 2,
    consecutiveZeroDiscovery: 1,
  };
  const good = applyCrawlOutcome(start, {
    discovered: 4,
    scraped: 3,
    failed: 0,
    duplicates: 1,
    rejected: 0,
    error: null,
  });
  assert.equal(good.totalDiscovered, 9);
  assert.equal(good.totalScraped, 5);
  assert.equal(good.consecutiveFailures, 0);
  assert.equal(good.consecutiveZeroDiscovery, 0);
  assert.equal(good.lastError, null);
  assert.equal(good.healthStatus, "healthy");
});

test("applyCrawlOutcome treats discovered-but-none-scraped and errors as failures", async () => {
  const { applyCrawlOutcome } = await import("@/lib/scraper/sources");
  const zero = emptyCrawlState();
  const discoveredNoScrape = applyCrawlOutcome(zero, {
    discovered: 3,
    scraped: 0,
    failed: 3,
    duplicates: 0,
    rejected: 0,
    error: null,
  });
  assert.equal(discoveredNoScrape.consecutiveFailures, 1);
  assert.equal(discoveredNoScrape.consecutiveZeroDiscovery, 0);

  const errored = applyCrawlOutcome(zero, {
    discovered: 0,
    scraped: 0,
    failed: 0,
    duplicates: 0,
    rejected: 0,
    error: "discover failed",
  });
  assert.equal(errored.consecutiveFailures, 1);
  assert.equal(errored.consecutiveZeroDiscovery, 1);
  assert.equal(errored.lastError, "discover failed");
});

test("summarizeSourceHealth flags failing sources with reasons", async () => {
  const { summarizeSourceHealth } = await import("@/lib/scraper/sources");
  const failing = summarizeSourceHealth({
    healthStatus: "failing",
    consecutiveFailures: 3,
    consecutiveZeroDiscovery: 0,
    lastError: "timeout",
    lastCrawledAt: new Date(),
  });
  assert.equal(failing.status, "failing");
  assert.equal(failing.flagged, true);
  assert.ok(failing.reasons.some((r) => r.includes("consecutive failed runs")));
  assert.ok(failing.reasons.some((r) => r.includes("timeout")));

  const healthy = summarizeSourceHealth({
    healthStatus: "healthy",
    consecutiveFailures: 0,
    consecutiveZeroDiscovery: 0,
    lastError: null,
    lastCrawledAt: new Date(),
  });
  assert.equal(healthy.flagged, false);
  assert.deepEqual(healthy.reasons, []);
});

test("summarizeSourceHealth explains recent failure and zero-discovery degradation", async () => {
  const { summarizeSourceHealth } = await import("@/lib/scraper/sources");
  const summary = summarizeSourceHealth({
    healthStatus: "degraded",
    consecutiveFailures: 1,
    consecutiveZeroDiscovery: 1,
    lastError: null,
    lastCrawledAt: new Date(),
  });

  assert.equal(summary.flagged, false);
  assert.deepEqual(summary.reasons, [
    "1 recent failed run(s)",
    "1 recent run(s) found no articles",
  ]);
});

test("syncContentSources creates one row per registry provider, idempotently", async () => {
  const { syncContentSources } = await import("@/lib/scraper/sources");
  const { PROVIDERS } = await import("@/lib/scraper/providers");

  const first = await syncContentSources();
  assert.equal(first.total, PROVIDERS.length);
  assert.equal(first.created, PROVIDERS.length);
  assert.equal(first.updated, 0);
  assert.equal(sources.size, PROVIDERS.length);

  const second = await syncContentSources();
  assert.equal(second.created, 0);
  assert.equal(second.updated, PROVIDERS.length);
  assert.equal(sources.size, PROVIDERS.length);
});

test("isProviderEnabled defaults to true for unsynced providers and honors the flag", async () => {
  const { isProviderEnabled, syncContentSources, setContentSourceEnabled } = await import(
    "@/lib/scraper/sources"
  );
  assert.equal(await isProviderEnabled("huffpost"), true);

  await syncContentSources();
  assert.equal(await isProviderEnabled("huffpost"), true);

  const updated = await setContentSourceEnabled("huffpost", false);
  assert.ok(updated);
  assert.equal(updated?.enabled, false);
  assert.equal(await isProviderEnabled("huffpost"), false);
});

test("setContentSourceEnabled returns null for an unknown provider", async () => {
  const { setContentSourceEnabled } = await import("@/lib/scraper/sources");
  assert.equal(await setContentSourceEnabled("does-not-exist", false), null);
});

test("recordCrawlRun upserts a row and computes failing health after repeated failures", async () => {
  const { recordCrawlRun } = await import("@/lib/scraper/sources");

  const failOutcome = failedDiscoveryOutcome();
  await recordCrawlRun("huffpost", failOutcome);
  await recordCrawlRun("huffpost", failOutcome);
  const row = await recordCrawlRun("huffpost", failOutcome);

  assert.equal(row.consecutiveFailures, 3);
  assert.equal(row.healthStatus, "failing");
  assert.equal(row.lastError, "crawl_run_failed");
  assert.ok(row.lastCrawledAt instanceof Date);
});

test("recordCrawlRun classifies a productive error-free crawl as successful", async () => {
  const { recordCrawlRun } = await import("@/lib/scraper/sources");

  await recordCrawlRun("huffpost", {
    discovered: 2,
    scraped: 1,
    failed: 0,
    duplicates: 1,
    rejected: 0,
    error: null,
  });

  assert.equal(crawlRuns.at(-1)?.outcome, "success");
});

test("sanitizeCrawlRunError maps auth and persistence prose to fixed machine codes", async () => {
  const { sanitizeCrawlRunError } = await import("@/lib/scraper/sources");

  assert.equal(sanitizeCrawlRunError("provider returned 401 unauthorized"), "crawl_auth_failed");
  assert.equal(
    sanitizeCrawlRunError("database constraint prevented persistence"),
    "crawl_persistence_failed",
  );
});

test("recordCrawlRun stores bounded privacy-safe history and lists recent runs", async () => {
  const { CRAWL_RUN_HISTORY_LIMIT, listRecentCrawlRuns, recordCrawlRun } = await import(
    "@/lib/scraper/sources"
  );

  for (let i = 0; i < CRAWL_RUN_HISTORY_LIMIT + 2; i++) {
    await recordCrawlRun(
      "nbc",
      {
        discovered: 1,
        scraped: 1,
        failed: 0,
        duplicates: 0,
        rejected: 0,
        source: "admin trigger",
        mode: "single provider",
        durationMs: 12.7,
        error: "failed fetching https://private.example/article private article sentence",
      },
      new Date(`2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
    );
  }

  assert.equal(crawlRuns.length, CRAWL_RUN_HISTORY_LIMIT);
  const recent = await listRecentCrawlRuns("nbc", 3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].source, "admin-trigger");
  assert.equal(recent[0].mode, "single-provider");
  assert.equal(recent[0].durationMs, 13);
  assert.equal(recent[0].error, "crawl_fetch_failed");
});
