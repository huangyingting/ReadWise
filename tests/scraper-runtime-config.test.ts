process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const ENV_NAMES = [
  "SCRAPER_MAX_BYTES",
  "SCRAPER_TIMEOUT_MS",
  "SCRAPER_HTML_NORMALIZE",
  "SCRAPER_READABILITY",
  "SCRAPER_FETCH_PROFILE_RETRY",
  "SCRAPER_FETCH_BROWSER",
  "SCRAPER_FETCH_READER",
  "SCRAPER_FETCH_WAYBACK",
  "SCRAPER_FETCH_429_RETRIES",
  "SCRAPER_FETCH_429_BASE_MS",
  "SCRAPER_FETCH_429_MAX_MS",
  "SCRAPER_QUALITY_CLASSIFIER",
  "SCRAPER_INGEST_PROPAGATION_GRACE_MS",
  "CANDIDATE_INGEST_ENABLED",
  "SCRAPER_REACTIVATION_BUDGET",
  "SCRAPER_BACKFILL_MAX_ITEMS_CEILING",
  "SCRAPER_BACKFILL_MAX_WINDOW_DAYS",
  "SCRAPER_BACKFILL_BATCH_SIZE",
  "SCRAPER_FORCE_RESCRAPE",
  "SCRAPER_HOST_CONCURRENCY",
  "SCRAPER_HOST_MIN_INTERVAL_MS",
  "SCRAPER_HOST_DAILY_CEILING",
  "SCRAPER_PROVIDER_DAILY_QUOTA",
  "SCRAPER_DISCOVERY_DAILY_BUDGET",
  "SCRAPER_BODY_DAILY_BUDGET",
  "SCRAPER_AI_DAILY_BUDGET",
  "SCRAPER_INCREMENTAL_RESERVED_SLOTS",
  "SCRAPER_BACKLOG_CAPACITY_THRESHOLD",
  "SCRAPER_HOST_ERROR_PAUSE_THRESHOLD",
  "SCRAPER_HOST_PAUSE_BASE_MS",
  "SCRAPER_HOST_PAUSE_MAX_MS",
] as const;

const previous = new Map<string, string | undefined>();

before(() => {
  for (const name of ENV_NAMES) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }
});

after(() => {
  for (const name of ENV_NAMES) {
    const value = previous.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("scraper runtime config exposes safe defaults for every operational control", async () => {
  const config = await import("@/lib/runtime-config/scraper");

  assert.equal(config.scraperMaxBytes(), 5 * 1024 * 1024);
  assert.equal(config.scraperTimeoutMs(), 15_000);
  assert.equal(config.scraperHtmlNormalize(), false);
  assert.equal(config.scraperReadability(), true);
  assert.equal(config.scraperFetchProfileRetry(), true);
  assert.equal(config.scraperFetchBrowser(), true);
  assert.equal(config.scraperFetchReader(), true);
  assert.equal(config.scraperFetchWayback(), true);
  assert.equal(config.scraperFetch429Retries(), 3);
  assert.equal(config.scraperFetch429BaseMs(), 1_000);
  assert.equal(config.scraperFetch429MaxMs(), 20_000);
  assert.equal(config.scraperQualityClassifier(), true);
  assert.equal(config.scraperIngestPropagationGraceMs(), 6 * 60 * 60 * 1000);
  assert.equal(config.isCandidateIngestEnabled(), false);
  assert.equal(config.scraperReactivationBudget(), 50);
  assert.equal(config.scraperBackfillMaxItemsCeiling(), 5_000);
  assert.equal(config.scraperBackfillMaxWindowDays(), 3_660);
  assert.equal(config.scraperBackfillBatchSize(), 50);
  assert.equal(config.scraperForceRescrapeEnabled(), true);
  assert.equal(config.scraperHostConcurrency(), 2);
  assert.equal(config.scraperHostMinIntervalMs(), 1_000);
  assert.equal(config.scraperHostDailyCeiling(), 5_000);
  assert.equal(config.scraperProviderDailyQuota(), 10_000);
  assert.equal(config.scraperDiscoveryDailyBudget(), 20_000);
  assert.equal(config.scraperBodyDailyBudget(), 5_000);
  assert.equal(config.scraperAiDailyBudget(), 2_000);
  assert.equal(config.scraperIncrementalReservedSlots(), 1);
  assert.equal(config.scraperBacklogCapacityThreshold(), 10_000);
  assert.equal(config.scraperHostErrorPauseThreshold(), 3);
  assert.equal(config.scraperHostPauseBaseMs(), 60_000);
  assert.equal(config.scraperHostPauseMaxMs(), 60 * 60_000);
});

test("scraper runtime config honors explicit bounded controls and kill switches", async () => {
  const config = await import("@/lib/runtime-config/scraper");
  process.env.SCRAPER_HTML_NORMALIZE = "true";
  process.env.SCRAPER_READABILITY = "false";
  process.env.SCRAPER_INGEST_PROPAGATION_GRACE_MS = "0";
  process.env.CANDIDATE_INGEST_ENABLED = "true";
  process.env.SCRAPER_REACTIVATION_BUDGET = "0";
  process.env.SCRAPER_BACKFILL_MAX_ITEMS_CEILING = "100";
  process.env.SCRAPER_BACKFILL_MAX_WINDOW_DAYS = "30";
  process.env.SCRAPER_BACKFILL_BATCH_SIZE = "10";
  process.env.SCRAPER_FORCE_RESCRAPE = "false";
  process.env.SCRAPER_HOST_CONCURRENCY = "0";
  process.env.SCRAPER_HOST_MIN_INTERVAL_MS = "0";
  process.env.SCRAPER_HOST_DAILY_CEILING = "0";
  process.env.SCRAPER_PROVIDER_DAILY_QUOTA = "0";
  process.env.SCRAPER_DISCOVERY_DAILY_BUDGET = "0";
  process.env.SCRAPER_BODY_DAILY_BUDGET = "0";
  process.env.SCRAPER_AI_DAILY_BUDGET = "0";
  process.env.SCRAPER_INCREMENTAL_RESERVED_SLOTS = "0";
  process.env.SCRAPER_BACKLOG_CAPACITY_THRESHOLD = "0";
  process.env.SCRAPER_HOST_ERROR_PAUSE_THRESHOLD = "0";
  process.env.SCRAPER_HOST_PAUSE_BASE_MS = "0";
  process.env.SCRAPER_HOST_PAUSE_MAX_MS = "0";

  assert.equal(config.scraperHtmlNormalize(), true);
  assert.equal(config.scraperReadability(), false);
  assert.equal(config.scraperIngestPropagationGraceMs(), 0);
  assert.equal(config.isCandidateIngestEnabled(), true);
  assert.equal(config.scraperReactivationBudget(), 0);
  assert.equal(config.scraperBackfillMaxItemsCeiling(), 100);
  assert.equal(config.scraperBackfillMaxWindowDays(), 30);
  assert.equal(config.scraperBackfillBatchSize(), 10);
  assert.equal(config.scraperForceRescrapeEnabled(), false);
  assert.equal(config.scraperHostConcurrency(), 0);
  assert.equal(config.scraperHostMinIntervalMs(), 0);
  assert.equal(config.scraperHostDailyCeiling(), 0);
  assert.equal(config.scraperProviderDailyQuota(), 0);
  assert.equal(config.scraperDiscoveryDailyBudget(), 0);
  assert.equal(config.scraperBodyDailyBudget(), 0);
  assert.equal(config.scraperAiDailyBudget(), 0);
  assert.equal(config.scraperIncrementalReservedSlots(), 0);
  assert.equal(config.scraperBacklogCapacityThreshold(), 0);
  assert.equal(config.scraperHostErrorPauseThreshold(), 0);
  assert.equal(config.scraperHostPauseBaseMs(), 0);
  assert.equal(config.scraperHostPauseMaxMs(), 0);
});
