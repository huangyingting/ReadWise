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

let sources: Map<string, SourceRow>;
let seq = 0;

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
      },
    },
  });
});

beforeEach(() => {
  sources = new Map();
  seq = 0;
});

test("computeHealthStatus buckets by consecutive failures and zero-discovery", async () => {
  const { computeHealthStatus } = await import("@/lib/content-sources");
  assert.equal(
    computeHealthStatus({ lastError: null, consecutiveFailures: 0, consecutiveZeroDiscovery: 0 }),
    "healthy",
  );
  assert.equal(
    computeHealthStatus({ lastError: "boom", consecutiveFailures: 0, consecutiveZeroDiscovery: 0 }),
    "degraded",
  );
  assert.equal(
    computeHealthStatus({ lastError: null, consecutiveFailures: 1, consecutiveZeroDiscovery: 0 }),
    "degraded",
  );
  assert.equal(
    computeHealthStatus({ lastError: null, consecutiveFailures: 3, consecutiveZeroDiscovery: 0 }),
    "failing",
  );
  assert.equal(
    computeHealthStatus({ lastError: null, consecutiveFailures: 0, consecutiveZeroDiscovery: 3 }),
    "failing",
  );
});

test("applyCrawlOutcome folds counters and resets streaks on a good run", async () => {
  const { applyCrawlOutcome } = await import("@/lib/content-sources");
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
  const { applyCrawlOutcome } = await import("@/lib/content-sources");
  const zero = {
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
  const { summarizeSourceHealth } = await import("@/lib/content-sources");
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

test("syncContentSources creates one row per registry provider, idempotently", async () => {
  const { syncContentSources } = await import("@/lib/content-sources");
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
    "@/lib/content-sources"
  );
  assert.equal(await isProviderEnabled("nbc"), true);

  await syncContentSources();
  assert.equal(await isProviderEnabled("nbc"), true);

  const updated = await setContentSourceEnabled("nbc", false);
  assert.ok(updated);
  assert.equal(updated?.enabled, false);
  assert.equal(await isProviderEnabled("nbc"), false);
});

test("setContentSourceEnabled returns null for an unknown provider", async () => {
  const { setContentSourceEnabled } = await import("@/lib/content-sources");
  assert.equal(await setContentSourceEnabled("does-not-exist", false), null);
});

test("recordCrawlRun upserts a row and computes failing health after repeated failures", async () => {
  const { recordCrawlRun } = await import("@/lib/content-sources");

  const failOutcome = {
    discovered: 0,
    scraped: 0,
    failed: 0,
    duplicates: 0,
    rejected: 0,
    error: "boom",
  };
  await recordCrawlRun("nbc", failOutcome);
  await recordCrawlRun("nbc", failOutcome);
  const row = await recordCrawlRun("nbc", failOutcome);

  assert.equal(row.consecutiveFailures, 3);
  assert.equal(row.healthStatus, "failing");
  assert.equal(row.lastError, "boom");
  assert.ok(row.lastCrawledAt instanceof Date);
});
