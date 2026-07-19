/**
 * Rate-governor durability + guarded-transition integration tests (#1094, P2.4).
 *
 * Engine-agnostic like `ingest-recovery.test.ts` / `page-commit.test.ts`: runs
 * on SQLite by default under `npm run test:db` and on PostgreSQL in CI, guarded
 * by `enabled` (RUN_DB_INTEGRATION=1). Exercises the REAL thin guarded-tx
 * persistence in `rate-governor-commit.ts` against the live database and proves:
 *
 *   - The per-UTC-day `ScraperBudgetWindow` counter DURABLY survives (idempotent
 *     upsert increment; a second read observes the committed count).
 *   - AC1: `reserveHostnameRequest` guards the daily ceiling — the counter never
 *     exceeds the cap and an over-limit reservation ROLLS BACK to `defer`.
 *   - req5/req6: `consumeCostBudget` defers expensive work once the daily budget
 *     is exhausted WITHOUT losing already-persisted state, and a 0 budget is
 *     unlimited.
 *   - AC2: `consumeProviderQuota` guards a provider's daily quota.
 *   - AC3: `recordHostnameResponse` DURABLY persists an auto-pause after the 429
 *     pattern and CLEARS it on a later success (visible via
 *     `readHostnameGovernorState`) — restart-safe, never leaking a URL.
 *
 * The two governor tables are NOT swept by the PREFIX provider-key cleanup, so a
 * local afterEach deletes the PREFIX-scoped hostKey/scopeKey rows this file made.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  BUDGET_SCOPE,
  GLOBAL_BUDGET_KEY,
  consumeCostBudget,
  consumeProviderQuota,
  readHostnameGovernorState,
  recordHostnameResponse,
  reserveHostnameRequest,
} from "@/lib/scraper/incremental/rate-governor-commit";
import {
  HOST_PAUSE_REASON,
  type BackoffConfig,
  type HostnameBudgetConfig,
  type ReservationConfig,
} from "@/lib/scraper/incremental/rate-governor";

import { enabled, PREFIX } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const hostKeys = new Set<string>();
const scopeKeys = new Set<string>();

function hostKey(): string {
  const k = `${PREFIX}host_${randomUUID().replace(/-/g, "")}`;
  hostKeys.add(k);
  return k;
}

function scopeKey(): string {
  const k = `${PREFIX}scope_${randomUUID().replace(/-/g, "")}`;
  scopeKeys.add(k);
  return k;
}

afterEach(async () => {
  if (!enabled) return;
  if (hostKeys.size > 0) {
    await prisma.hostnameGovernorState.deleteMany({ where: { hostKey: { in: [...hostKeys] } } });
    await prisma.scraperBudgetWindow.deleteMany({ where: { scopeKey: { in: [...hostKeys] } } });
  }
  if (scopeKeys.size > 0) {
    await prisma.scraperBudgetWindow.deleteMany({ where: { scopeKey: { in: [...scopeKeys] } } });
  }
  // Cost budgets share the GLOBAL scopeKey; scope them by the cost scope only for
  // the days these tests wrote (safe: budgets are the only writers of those scopes
  // under this test key convention, and cleanup is per-run).
  hostKeys.clear();
  scopeKeys.clear();
});

const NOW = new Date("2026-07-19T12:00:00.000Z");

const HOST_CONFIG: HostnameBudgetConfig = {
  maxConcurrency: 4,
  minIntervalMs: 0,
  dailyCeiling: 3,
};
const NO_RESERVATION: ReservationConfig = { incrementalReservedSlots: 0 };
const BACKOFF: BackoffConfig = { errorThreshold: 1, basePauseMs: 60_000, maxPauseMs: 3_600_000 };

// ---------------------------------------------------------------------------
// ScraperBudgetWindow durability + AC1 daily-ceiling guard
// ---------------------------------------------------------------------------

test("durability: reserveHostnameRequest increments a per-day counter that a later read observes", { skip: !enabled }, async () => {
  const host = hostKey();

  const first = await reserveHostnameRequest({
    hostKey: host,
    inFlight: 0,
    requestClass: "discovery",
    priorityTier: "incremental",
    config: HOST_CONFIG,
    reservation: NO_RESERVATION,
    now: NOW,
  });
  assert.equal(first.decision, "admit");

  const row = await prisma.scraperBudgetWindow.findUnique({
    where: {
      scope_scopeKey_utcDay: { scope: BUDGET_SCOPE.HOSTNAME, scopeKey: host, utcDay: "2026-07-19" },
    },
  });
  assert.equal(row?.requestCount, 1);

  // The min-interval anchor is durably recorded on the host state row.
  const state = await prisma.hostnameGovernorState.findUnique({ where: { hostKey: host } });
  assert.ok(state?.lastRequestAt instanceof Date);
});

test("AC1: the shared daily ceiling caps the counter — the over-limit reservation rolls back to defer", { skip: !enabled }, async () => {
  const host = hostKey();
  const base = { hostKey: host, inFlight: 0, requestClass: "body" as const, priorityTier: "incremental" as const, config: HOST_CONFIG, reservation: NO_RESERVATION };

  for (let i = 0; i < HOST_CONFIG.dailyCeiling; i++) {
    const d = await reserveHostnameRequest({ ...base, now: new Date(NOW.getTime() + i) });
    assert.equal(d.decision, "admit", `reservation #${i + 1} should admit`);
  }

  const over = await reserveHostnameRequest({ ...base, now: new Date(NOW.getTime() + 100) });
  assert.equal(over.decision, "defer");

  const row = await prisma.scraperBudgetWindow.findUnique({
    where: {
      scope_scopeKey_utcDay: { scope: BUDGET_SCOPE.HOSTNAME, scopeKey: host, utcDay: "2026-07-19" },
    },
  });
  assert.equal(row?.requestCount, HOST_CONFIG.dailyCeiling, "counter must never exceed the ceiling");
});

// ---------------------------------------------------------------------------
// Cost budgets (req5 / req6)
// ---------------------------------------------------------------------------

test("req6: an exhausted body budget defers expensive work while the counter stays capped", { skip: !enabled }, async () => {
  const budget = 2;
  // A deterministic far-future UTC day isolates this global cost-budget window
  // from any real usage; wipe it first so the assertions are exact.
  const testDay = new Date(Date.UTC(2999, 0, 1, 12, 0, 0));
  const cleanup = {
    where: { scope: BUDGET_SCOPE.BODY_BUDGET, scopeKey: GLOBAL_BUDGET_KEY, utcDay: "2999-01-01" },
  };
  await prisma.scraperBudgetWindow.deleteMany(cleanup);

  const a = await consumeCostBudget({ kind: "body", dailyBudget: budget, now: testDay });
  const b = await consumeCostBudget({ kind: "body", dailyBudget: budget, now: testDay });
  const c = await consumeCostBudget({ kind: "body", dailyBudget: budget, now: testDay });

  assert.equal(a.admitted, true);
  assert.equal(b.admitted, true);
  assert.equal(c.admitted, false);

  const row = await prisma.scraperBudgetWindow.findUnique({
    where: {
      scope_scopeKey_utcDay: { scope: BUDGET_SCOPE.BODY_BUDGET, scopeKey: GLOBAL_BUDGET_KEY, utcDay: "2999-01-01" },
    },
  });
  assert.equal(row?.requestCount, budget, "budget counter must not exceed the cap after a rollback");

  await prisma.scraperBudgetWindow.deleteMany(cleanup);
});

test("req5: a 0 (unlimited) budget always admits", { skip: !enabled }, async () => {
  const testDay = new Date(Date.UTC(2999, 0, 2, 12, 0, 0));
  await prisma.scraperBudgetWindow.deleteMany({
    where: { scope: BUDGET_SCOPE.DISCOVERY_BUDGET, scopeKey: GLOBAL_BUDGET_KEY, utcDay: "2999-01-02" },
  });
  for (let i = 0; i < 5; i++) {
    const r = await consumeCostBudget({ kind: "discovery", dailyBudget: 0, now: testDay });
    assert.equal(r.admitted, true);
    assert.equal(r.remaining, null);
  }
  await prisma.scraperBudgetWindow.deleteMany({
    where: { scope: BUDGET_SCOPE.DISCOVERY_BUDGET, scopeKey: GLOBAL_BUDGET_KEY, utcDay: "2999-01-02" },
  });
});

// ---------------------------------------------------------------------------
// Provider quota (AC2 support)
// ---------------------------------------------------------------------------

test("AC2: a provider daily quota is guarded — the counter never exceeds the quota", { skip: !enabled }, async () => {
  const provider = scopeKey();
  const quota = 2;

  assert.equal((await consumeProviderQuota({ providerKey: provider, dailyQuota: quota, now: NOW })).admitted, true);
  assert.equal((await consumeProviderQuota({ providerKey: provider, dailyQuota: quota, now: NOW })).admitted, true);
  assert.equal((await consumeProviderQuota({ providerKey: provider, dailyQuota: quota, now: NOW })).admitted, false);

  const row = await prisma.scraperBudgetWindow.findUnique({
    where: {
      scope_scopeKey_utcDay: { scope: BUDGET_SCOPE.PROVIDER, scopeKey: provider, utcDay: "2026-07-19" },
    },
  });
  assert.equal(row?.requestCount, quota);
});

// ---------------------------------------------------------------------------
// AC3: auto-pause persistence + recovery
// ---------------------------------------------------------------------------

test("AC3: a 429 durably auto-pauses the hostname and a later success clears it (no URL leak)", { skip: !enabled }, async () => {
  const host = hostKey();

  const paused = await recordHostnameResponse({
    hostKey: host,
    signal: { kind: "http-status", status: 429 },
    config: BACKOFF,
    now: NOW,
  });
  assert.equal(paused.lastFailureReason, HOST_PAUSE_REASON.HTTP_429);
  assert.ok(paused.pausedUntil && paused.pausedUntil.getTime() > NOW.getTime());

  // Durability: a fresh read observes the committed pause.
  const persisted = await readHostnameGovernorState(host);
  assert.ok(persisted.pausedUntil && persisted.pausedUntil.getTime() > NOW.getTime());
  assert.equal(persisted.consecutiveErrors, 1);

  const row = await prisma.hostnameGovernorState.findUnique({ where: { hostKey: host } });
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /https?:\/\//, "governor state must not persist a URL");

  // Recovery: a later OK clears the pause and error streak.
  const recovered = await recordHostnameResponse({
    hostKey: host,
    signal: { kind: "ok" },
    config: BACKOFF,
    now: new Date(NOW.getTime() + 120_000),
  });
  assert.equal(recovered.pausedUntil, null);
  assert.equal(recovered.consecutiveErrors, 0);

  const cleared = await readHostnameGovernorState(host);
  assert.equal(cleared.pausedUntil, null);
});

test("AC3: an explicit Retry-After pauses for exactly the advertised window", { skip: !enabled }, async () => {
  const host = hostKey();
  const retryAfterMs = 90_000;

  const paused = await recordHostnameResponse({
    hostKey: host,
    signal: { kind: "http-status", status: 503, retryAfterMs },
    config: BACKOFF,
    now: NOW,
  });
  assert.equal(paused.lastFailureReason, HOST_PAUSE_REASON.RETRY_AFTER);
  assert.equal(paused.pausedUntil?.getTime(), NOW.getTime() + retryAfterMs);
});
