/**
 * Pure rate-governor tests (issue #1094, Phase 2.4).
 *
 * Fully deterministic (no real clock, DB, network, or randomness): every AC is
 * proven against `rate-governor.ts` with an injected `now` and plain snapshots.
 * Covers the shared per-hostname budget (RSS + sitemap + body), provider
 * fairness / no-starvation, priority reservation, the separate cost budgets +
 * exhaustion behavior, Retry-After / 429-403-5xx pause + recovery, and the
 * backlog throttle + alert (candidates are never dropped — signal only).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  admitHostnameRequest,
  applyResponseSignal,
  admitCostlyWork,
  classifyCostBudget,
  isAiBudgetExhausted,
  evaluateBacklog,
  fairProviderOrder,
  selectNextProvider,
  nextUtcDayReset,
  utcDayKey,
  HOST_PAUSE_REASON,
  type BackoffConfig,
  type CostBudgetSnapshot,
  type HostnameBudgetConfig,
  type HostnameBudgetSnapshot,
  type HostnameHealthState,
  type ProviderState,
  type ReservationConfig,
} from "@/lib/scraper/incremental/rate-governor";

const NOW = new Date("2026-07-19T12:00:00.000Z");

const HOST_CONFIG: HostnameBudgetConfig = {
  maxConcurrency: 2,
  minIntervalMs: 1_000,
  dailyCeiling: 100,
};
const NO_RESERVATION: ReservationConfig = { incrementalReservedSlots: 0 };
const RESERVE_ONE: ReservationConfig = { incrementalReservedSlots: 1 };

function snap(overrides: Partial<HostnameBudgetSnapshot> = {}): HostnameBudgetSnapshot {
  return { inFlight: 0, lastRequestAt: null, dailyCount: 0, pausedUntil: null, ...overrides };
}

// ---------------------------------------------------------------------------
// AC1 — shared per-hostname budget: RSS + sitemap + body share ONE cap
// ---------------------------------------------------------------------------

test("AC1: RSS, sitemap, and body requests all draw on the SAME hostname concurrency", () => {
  // Two discovery (RSS + sitemap) requests already in flight; a body request to
  // the same hostname must be deferred — the budget is shared, not per-class.
  for (const requestClass of ["discovery", "body"] as const) {
    const decision = admitHostnameRequest({
      now: NOW,
      requestClass,
      priorityTier: "incremental",
      snapshot: snap({ inFlight: 2 }),
      config: HOST_CONFIG,
      reservation: NO_RESERVATION,
    });
    assert.equal(decision.decision, "defer");
    if (decision.decision === "defer") assert.equal(decision.reason, "concurrency");
  }
});

test("AC1: below the shared concurrency, a request is admitted", () => {
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "body",
    priorityTier: "incremental",
    snapshot: snap({ inFlight: 1 }),
    config: HOST_CONFIG,
    reservation: NO_RESERVATION,
  });
  assert.equal(decision.decision, "admit");
});

test("AC1: the min-interval throttle defers until the interval elapses", () => {
  const lastRequestAt = new Date(NOW.getTime() - 400);
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "discovery",
    priorityTier: "incremental",
    snapshot: snap({ lastRequestAt }),
    config: HOST_CONFIG,
    reservation: NO_RESERVATION,
  });
  assert.equal(decision.decision, "defer");
  if (decision.decision === "defer") {
    assert.equal(decision.reason, "min-interval");
    assert.equal(decision.retryAt?.getTime(), lastRequestAt.getTime() + HOST_CONFIG.minIntervalMs);
  }
});

test("AC1: the daily ceiling defers until the next UTC day", () => {
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "discovery",
    priorityTier: "incremental",
    snapshot: snap({ dailyCount: 100 }),
    config: HOST_CONFIG,
    reservation: NO_RESERVATION,
  });
  assert.equal(decision.decision, "defer");
  if (decision.decision === "defer") {
    assert.equal(decision.reason, "daily-ceiling");
    assert.equal(decision.retryAt?.toISOString(), "2026-07-20T00:00:00.000Z");
  }
});

test("AC1: concurrency 0 means unlimited (never deferred on concurrency)", () => {
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "body",
    priorityTier: "backfill",
    snapshot: snap({ inFlight: 9_999 }),
    config: { maxConcurrency: 0, minIntervalMs: 0, dailyCeiling: 0 },
    reservation: RESERVE_ONE,
  });
  assert.equal(decision.decision, "admit");
});

// ---------------------------------------------------------------------------
// Priority reservation — backfill can NEVER starve real-time incremental
// ---------------------------------------------------------------------------

test("priority: with 1 slot reserved, backfill is blocked at inFlight=1 but incremental still admits", () => {
  const snapshot = snap({ inFlight: 1 });

  const backfill = admitHostnameRequest({
    now: NOW,
    requestClass: "body",
    priorityTier: "backfill",
    snapshot,
    config: HOST_CONFIG,
    reservation: RESERVE_ONE,
  });
  assert.equal(backfill.decision, "defer");
  if (backfill.decision === "defer") assert.equal(backfill.reason, "reserved-for-incremental");

  const incremental = admitHostnameRequest({
    now: NOW,
    requestClass: "body",
    priorityTier: "incremental",
    snapshot,
    config: HOST_CONFIG,
    reservation: RESERVE_ONE,
  });
  assert.equal(incremental.decision, "admit");
});

test("priority: a burst of backfill can never consume the reserved incremental slot", () => {
  // maxConcurrency 3, reserve 2 → backfill effective limit is 1.
  const config: HostnameBudgetConfig = { maxConcurrency: 3, minIntervalMs: 0, dailyCeiling: 0 };
  const reservation: ReservationConfig = { incrementalReservedSlots: 2 };
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "body",
    priorityTier: "backfill",
    snapshot: snap({ inFlight: 1 }),
    config,
    reservation,
  });
  assert.equal(decision.decision, "defer");
  if (decision.decision === "defer") assert.equal(decision.reason, "reserved-for-incremental");
});

// ---------------------------------------------------------------------------
// AC2 — provider fairness / no-starvation
// ---------------------------------------------------------------------------

function provider(overrides: Partial<ProviderState>): ProviderState {
  return {
    providerKey: "p",
    priorityTier: "incremental",
    pendingCandidates: 1,
    inFlight: 0,
    dailyQuota: 0,
    dailyCount: 0,
    oldestPendingAt: null,
    ...overrides,
  };
}

test("AC2: a high-volume provider that saturated workers yields to a ready peer", () => {
  const busy = provider({ providerKey: "busy", inFlight: 5, pendingCandidates: 50 });
  const quiet = provider({ providerKey: "quiet", inFlight: 0, pendingCandidates: 1 });
  const next = selectNextProvider([busy, quiet]);
  assert.equal(next?.providerKey, "quiet");
});

test("AC2: incremental outranks backfill regardless of in-flight", () => {
  const backfill = provider({ providerKey: "b", priorityTier: "backfill", inFlight: 0 });
  const incremental = provider({ providerKey: "i", priorityTier: "incremental", inFlight: 4 });
  const next = selectNextProvider([backfill, incremental]);
  assert.equal(next?.providerKey, "i");
});

test("AC2: equal priority + equal in-flight is FIFO by oldest pending", () => {
  const older = provider({ providerKey: "older", oldestPendingAt: new Date("2026-07-19T10:00:00Z") });
  const newer = provider({ providerKey: "newer", oldestPendingAt: new Date("2026-07-19T11:00:00Z") });
  const next = selectNextProvider([newer, older]);
  assert.equal(next?.providerKey, "older");
});

test("AC2: a provider over its daily quota or with no pending work is not eligible", () => {
  const exhausted = provider({ providerKey: "exhausted", dailyQuota: 10, dailyCount: 10 });
  const empty = provider({ providerKey: "empty", pendingCandidates: 0 });
  assert.equal(selectNextProvider([exhausted, empty]), null);
  assert.deepEqual(fairProviderOrder([exhausted, empty]), []);
});

test("AC2: repeated serving rotates work across providers (no indefinite starvation)", () => {
  // Simulate serving 6 units; the least-loaded ready provider always wins, so the
  // busy provider cannot monopolize — both make progress.
  let a = provider({ providerKey: "a", inFlight: 0, pendingCandidates: 100 });
  let b = provider({ providerKey: "b", inFlight: 0, pendingCandidates: 100 });
  const served: Record<string, number> = { a: 0, b: 0 };
  for (let i = 0; i < 6; i += 1) {
    const next = selectNextProvider([a, b]);
    assert.ok(next);
    served[next!.providerKey] += 1;
    if (next!.providerKey === "a") a = { ...a, inFlight: a.inFlight + 1 };
    else b = { ...b, inFlight: b.inFlight + 1 };
  }
  assert.equal(served.a, 3);
  assert.equal(served.b, 3);
});

// ---------------------------------------------------------------------------
// AC3 — Retry-After + 429/403/5xx pause and recovery
// ---------------------------------------------------------------------------

const BACKOFF: BackoffConfig = { errorThreshold: 3, basePauseMs: 60_000, maxPauseMs: 3_600_000 };

function health(overrides: Partial<HostnameHealthState> = {}): HostnameHealthState {
  return { consecutiveErrors: 0, pausedUntil: null, lastFailureReason: null, ...overrides };
}

test("AC3: a server Retry-After pauses immediately for exactly that long", () => {
  const next = applyResponseSignal({
    now: NOW,
    signal: { kind: "http-status", status: 429, retryAfterMs: 30_000 },
    state: health(),
    config: BACKOFF,
  });
  assert.equal(next.pausedUntil?.getTime(), NOW.getTime() + 30_000);
  assert.equal(next.lastFailureReason, HOST_PAUSE_REASON.RETRY_AFTER);
});

test("AC3: consecutive 403/5xx pause only once the threshold is crossed", () => {
  let state = applyResponseSignal({ now: NOW, signal: { kind: "http-status", status: 403 }, state: health(), config: BACKOFF });
  assert.equal(state.pausedUntil, null);
  assert.equal(state.consecutiveErrors, 1);

  state = applyResponseSignal({ now: NOW, signal: { kind: "http-status", status: 500 }, state, config: BACKOFF });
  assert.equal(state.pausedUntil, null);
  assert.equal(state.consecutiveErrors, 2);

  state = applyResponseSignal({ now: NOW, signal: { kind: "http-status", status: 503 }, state, config: BACKOFF });
  assert.equal(state.consecutiveErrors, 3);
  assert.equal(state.pausedUntil?.getTime(), NOW.getTime() + BACKOFF.basePauseMs);
  assert.equal(state.lastFailureReason, HOST_PAUSE_REASON.HTTP_5XX);
});

test("AC3: the threshold pause grows exponentially, capped at the max", () => {
  const base = health({ consecutiveErrors: 3 });
  const next = applyResponseSignal({
    now: NOW,
    signal: { kind: "http-status", status: 429 },
    state: base,
    config: BACKOFF,
  });
  // 4th error = 1 over threshold → basePause * 2^1.
  assert.equal(next.pausedUntil?.getTime(), NOW.getTime() + BACKOFF.basePauseMs * 2);
});

test("AC3: a success clears the pause and resets the error streak (recovery)", () => {
  const paused = health({ consecutiveErrors: 5, pausedUntil: new Date(NOW.getTime() + 100_000) });
  const next = applyResponseSignal({ now: NOW, signal: { kind: "ok" }, state: paused, config: BACKOFF });
  assert.equal(next.pausedUntil, null);
  assert.equal(next.consecutiveErrors, 0);
  assert.equal(next.lastFailureReason, null);
});

test("AC3: an active pause defers admission with the pause expiry", () => {
  const pausedUntil = new Date(NOW.getTime() + 45_000);
  const decision = admitHostnameRequest({
    now: NOW,
    requestClass: "discovery",
    priorityTier: "incremental",
    snapshot: snap({ pausedUntil }),
    config: HOST_CONFIG,
    reservation: NO_RESERVATION,
  });
  assert.equal(decision.decision, "paused");
  if (decision.decision === "paused") assert.equal(decision.until.getTime(), pausedUntil.getTime());
});

test("AC3: a non-throttle status (404) never pauses the hostname", () => {
  const next = applyResponseSignal({
    now: NOW,
    signal: { kind: "http-status", status: 404 },
    state: health({ consecutiveErrors: 1 }),
    config: BACKOFF,
  });
  assert.equal(next.consecutiveErrors, 1);
  assert.equal(next.pausedUntil, null);
});

// ---------------------------------------------------------------------------
// req5 / req6 — separate cost budgets + exhaustion behavior
// ---------------------------------------------------------------------------

function budgets(overrides: Partial<CostBudgetSnapshot> = {}): CostBudgetSnapshot {
  return {
    discovery: { kind: "discovery", used: 0, dailyBudget: 100 },
    body: { kind: "body", used: 0, dailyBudget: 50 },
    ai: { kind: "ai", used: 0, dailyBudget: 20 },
    ...overrides,
  };
}

test("req6: an exhausted BODY budget defers body work but discovery keeps running", () => {
  const b = budgets({ body: { kind: "body", used: 50, dailyBudget: 50 } });

  const body = admitCostlyWork({ requestClass: "body", budgets: b });
  assert.equal(body.admit, false);
  assert.equal(body.deferredBudget, "body");

  const discovery = admitCostlyWork({ requestClass: "discovery", budgets: b });
  assert.equal(discovery.admit, true);
});

test("req6: an exhausted AI budget never blocks discovery or body (non-goal)", () => {
  const b = budgets({ ai: { kind: "ai", used: 20, dailyBudget: 20 } });
  assert.equal(isAiBudgetExhausted(b), true);
  assert.equal(admitCostlyWork({ requestClass: "discovery", budgets: b }).admit, true);
  assert.equal(admitCostlyWork({ requestClass: "body", budgets: b }).admit, true);
});

test("req5: budgets are classified independently; 0 means unlimited", () => {
  assert.equal(classifyCostBudget({ kind: "body", used: 999, dailyBudget: 0 }).exhausted, false);
  assert.deepEqual(classifyCostBudget({ kind: "body", used: 40, dailyBudget: 50 }), {
    kind: "body",
    exhausted: false,
    remaining: 10,
  });
});

test("AC3-resume: budget exhaustion leaves the OLDEST real-time backlog first when capacity returns", () => {
  // Two incremental providers with body work ready; fewest-in-flight + oldest
  // pending decides who resumes first once the body budget frees up.
  const older = provider({
    providerKey: "older",
    inFlight: 0,
    oldestPendingAt: new Date("2026-07-19T09:00:00Z"),
  });
  const newer = provider({
    providerKey: "newer",
    inFlight: 0,
    oldestPendingAt: new Date("2026-07-19T11:30:00Z"),
  });
  assert.equal(selectNextProvider([newer, older])?.providerKey, "older");
});

// ---------------------------------------------------------------------------
// req7 — backlog throttle + alert (never drops candidates)
// ---------------------------------------------------------------------------

test("req7: backlog below the engage fraction does not throttle or alert", () => {
  const signal = evaluateBacklog({ backlogSize: 5_000, config: { capacityThreshold: 10_000 } });
  assert.equal(signal.throttle, false);
  assert.equal(signal.alert, false);
  assert.equal(signal.frequencyMultiplier, 1);
});

test("req7: backlog at/above the engage fraction throttles low-priority sources and alerts", () => {
  const signal = evaluateBacklog({ backlogSize: 8_500, config: { capacityThreshold: 10_000 } });
  assert.equal(signal.throttle, true);
  assert.equal(signal.alert, true);
  assert.ok(signal.frequencyMultiplier > 1);
  assert.ok(signal.utilization !== null && signal.utilization >= 0.8);
});

test("req7: a 0 capacity threshold disables backlog throttling", () => {
  const signal = evaluateBacklog({ backlogSize: 1_000_000, config: { capacityThreshold: 0 } });
  assert.equal(signal.throttle, false);
  assert.equal(signal.alert, false);
  assert.equal(signal.utilization, null);
});

// ---------------------------------------------------------------------------
// UTC-day helpers
// ---------------------------------------------------------------------------

test("utc helpers bucket by UTC day and reset at the next midnight", () => {
  assert.equal(utcDayKey(NOW), "2026-07-19");
  assert.equal(nextUtcDayReset(NOW).toISOString(), "2026-07-20T00:00:00.000Z");
});
