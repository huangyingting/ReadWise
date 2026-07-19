/**
 * Pure unit tests for discovery-source observability + auto-degradation (issue
 * #1089, Phase 1.9).
 *
 * The modules under test (`observability.ts`, `degradation.ts`) are PURE — no
 * network, no DB, no clock. These tests cover:
 *   - the derived operational-status taxonomy (AC1): every one of
 *     healthy-caught-up / healthy-backlog / partial / stalled / gap-detected;
 *   - the metric summary rollups (candidate counts, backlog, delay percentiles,
 *     volume anomaly, watermark stall);
 *   - the provider-aware degradation thresholds + the zero-discovery-streak
 *     accounting that drives the sustained HTTP-200/zero-discovery demotion (AC3);
 *   - AC4: the emitted summary contains ONLY ids/counts/statuses/durations —
 *     never a URL, article content, or secret.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

import {
  DEFAULT_STATUS_THRESHOLDS,
  classifyVolumeAnomaly,
  computeSourceMetrics,
  deriveOperationalStatus,
  type SourceStateSnapshot,
} from "@/lib/scraper/incremental/observability";
import {
  DEFAULT_DEGRADATION_THRESHOLDS,
  decideDegradation,
  nextZeroDiscoveryStreak,
  resolveDegradationThresholds,
} from "@/lib/scraper/incremental/degradation";

const M = DiscoverySourceLifecycleMode;
const H = DiscoverySourceHealth;
const G = DiscoveryGapState;
const S = CrawlCandidateStatus;

const NOW = new Date("2026-07-19T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function snapshot(overrides: Partial<SourceStateSnapshot> = {}): SourceStateSnapshot {
  return {
    role: DiscoverySourceRole.PRIMARY_FEED,
    lifecycleMode: M.ACTIVE,
    automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
    health: H.HEALTHY,
    gapState: G.NONE,
    gapDetectedAt: null,
    watermarkAt: new Date(NOW.getTime() - DAY_MS),
    baselineCompletedAt: new Date(NOW.getTime() - 30 * DAY_MS),
    baselineObservedCount: 100,
    lastRunAt: new Date(NOW.getTime() - 60_000),
    nextRunAt: new Date(NOW.getTime() + 60_000),
    activatedAt: new Date(NOW.getTime() - 20 * DAY_MS),
    backoffLevel: 0,
    backoffUntil: null,
    consecutiveFailures: 0,
    consecutiveZeroDiscoveryRuns: 0,
    discoveryBudgetPerRun: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Operational-status taxonomy (AC1)
// ---------------------------------------------------------------------------

test("status: HEALTHY + caught up + no backlog → healthy-caught-up", () => {
  const summary = computeSourceMetrics({ now: NOW, source: snapshot(), candidateCounts: { [S.INGESTED]: 10 } });
  assert.equal(summary.status, "healthy-caught-up");
  assert.equal(summary.backlogCount, 0);
});

test("status: HEALTHY + queued/ingesting work → healthy-backlog", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: { [S.QUEUED]: 3, [S.INGESTING]: 1, [S.INGESTED]: 10 },
  });
  assert.equal(summary.status, "healthy-backlog");
  assert.equal(summary.backlogCount, 4);
});

test("status: DEGRADED health → partial", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ health: H.DEGRADED }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "partial");
});

test("status: SUSPECTED gap → partial", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ gapState: G.SUSPECTED }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "partial");
});

test("status: active backoff → partial", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ backoffUntil: new Date(NOW.getTime() + 60_000), backoffLevel: 1 }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.backoffActive, true);
});

test("status: FAILING health → stalled", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ health: H.FAILING }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "stalled");
});

test("status: ACTIVE zero-discovery streak past status threshold → stalled", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ consecutiveZeroDiscoveryRuns: DEFAULT_STATUS_THRESHOLDS.zeroDiscoveryStreak }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "stalled");
});

test("status: ACTIVE watermark stalled past status threshold → stalled", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ watermarkAt: new Date(NOW.getTime() - 20 * DAY_MS) }),
    candidateCounts: {},
  });
  assert.equal(summary.status, "stalled");
});

test("status: DETECTED gap always wins over healthy signals", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ gapState: G.DETECTED, gapDetectedAt: new Date(NOW.getTime() - DAY_MS), health: H.HEALTHY }),
    candidateCounts: { [S.INGESTED]: 5 },
  });
  assert.equal(summary.status, "gap-detected");
  assert.equal(summary.gapAgeSeconds, 86_400);
});

test("status: a NON-active source never reads stalled from a zero-discovery streak", () => {
  // A high streak only demotes/flags an ACTIVE source; a SHADOW source ignores it.
  const status = deriveOperationalStatus({
    lifecycleMode: M.SHADOW,
    health: H.HEALTHY,
    gapState: G.NONE,
    zeroDiscoveryStreak: 999,
    watermarkStallSeconds: 0,
    consecutiveFailures: 0,
    backoffActive: false,
    backlogCount: 0,
    thresholds: DEFAULT_STATUS_THRESHOLDS,
  });
  assert.equal(status, "healthy-caught-up");
});

// ---------------------------------------------------------------------------
// Metric rollups
// ---------------------------------------------------------------------------

test("candidate rollups: totals, backlog, conflict rate", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: {
      [S.DISCOVERED]: 4,
      [S.QUEUED]: 2,
      [S.INGESTING]: 1,
      [S.INGESTED]: 10,
      [S.REJECTED]: 3,
      [S.FAILED]: 1,
      [S.CONFLICT]: 2,
    },
  });
  assert.equal(summary.totalCandidates, 23);
  assert.equal(summary.backlogCount, 3);
  assert.equal(summary.discoveredCount, 4);
  assert.equal(summary.conflictCount, 2);
  assert.ok(summary.conflictRate !== null && Math.abs(summary.conflictRate - 2 / 23) < 1e-9);
});

test("publication-to-discovery delay percentiles are whole seconds", () => {
  const delaysMs = [1000, 2000, 3000, 4000, 100_000];
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: {},
    publicationToDiscoveryDelaysMs: delaysMs,
  });
  const delay = summary.publicationToDiscoveryDelay;
  assert.ok(delay);
  assert.equal(delay.sampleCount, 5);
  assert.equal(delay.maxSeconds, 100);
  assert.equal(delay.p50Seconds, 3);
});

test("delay percentiles are null when there are no dated samples", () => {
  const summary = computeSourceMetrics({ now: NOW, source: snapshot(), candidateCounts: {} });
  assert.equal(summary.publicationToDiscoveryDelay, null);
});

test("volume anomaly: spike / drop / none / unknown", () => {
  assert.equal(classifyVolumeAnomaly({ recentDayCount: 30, baselineDailyMean: 5 }), "spike");
  assert.equal(classifyVolumeAnomaly({ recentDayCount: 1, baselineDailyMean: 20 }), "drop");
  assert.equal(classifyVolumeAnomaly({ recentDayCount: 6, baselineDailyMean: 5 }), "none");
  assert.equal(classifyVolumeAnomaly(undefined), "unknown");
  assert.equal(classifyVolumeAnomaly({ recentDayCount: 3, baselineDailyMean: 0 }), "unknown");
});

test("watermark stall is exposed in whole seconds", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot({ watermarkAt: new Date(NOW.getTime() - 3_600_000) }),
    candidateCounts: {},
  });
  assert.equal(summary.watermarkStallSeconds, 3_600);
});

// ---------------------------------------------------------------------------
// Degradation thresholds (AC3)
// ---------------------------------------------------------------------------

test("degradation: only ACTIVE sources are considered", () => {
  for (const mode of [M.DISABLED, M.BASELINE, M.SHADOW, M.PAUSED, M.RETIRED]) {
    const decision = decideDegradation({
      lifecycleMode: mode,
      zeroDiscoveryStreak: 9999,
      watermarkStallMs: 9999 * DAY_MS,
      consecutiveFailures: 100,
    });
    assert.deepEqual(decision, { action: "keep", reason: "not-active" });
  }
});

test("degradation: sustained zero-discovery streak demotes an ACTIVE source (AC3)", () => {
  const decision = decideDegradation({
    lifecycleMode: M.ACTIVE,
    zeroDiscoveryStreak: DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak,
    watermarkStallMs: 0,
    consecutiveFailures: 0,
  });
  assert.deepEqual(decision, { action: "demote-to-shadow", reason: "zero-discovery-drift" });
});

test("degradation: below the streak threshold keeps the source ACTIVE", () => {
  const decision = decideDegradation({
    lifecycleMode: M.ACTIVE,
    zeroDiscoveryStreak: DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak - 1,
    watermarkStallMs: 0,
    consecutiveFailures: 0,
  });
  assert.deepEqual(decision, { action: "keep", reason: "within-thresholds" });
});

test("degradation: a stalled watermark demotes an ACTIVE source", () => {
  const decision = decideDegradation({
    lifecycleMode: M.ACTIVE,
    zeroDiscoveryStreak: 0,
    watermarkStallMs: DEFAULT_DEGRADATION_THRESHOLDS.maxWatermarkStallMs!,
    consecutiveFailures: 0,
  });
  assert.deepEqual(decision, { action: "demote-to-shadow", reason: "watermark-stall" });
});

test("degradation: run failures alone never demote (handled by backoff)", () => {
  const decision = decideDegradation({
    lifecycleMode: M.ACTIVE,
    zeroDiscoveryStreak: 0,
    watermarkStallMs: null,
    consecutiveFailures: 50,
  });
  assert.equal(decision.action, "keep");
});

test("degradation: provider-aware thresholds override the defaults", () => {
  const thresholds = resolveDegradationThresholds("provider-x", {
    "provider-x": { maxZeroDiscoveryStreak: 2 },
  });
  assert.equal(thresholds.maxZeroDiscoveryStreak, 2);
  const decision = decideDegradation(
    { lifecycleMode: M.ACTIVE, zeroDiscoveryStreak: 2, watermarkStallMs: null, consecutiveFailures: 0 },
    thresholds,
  );
  assert.equal(decision.action, "demote-to-shadow");
  // A different provider still uses the default.
  assert.equal(
    resolveDegradationThresholds("other", { "provider-x": { maxZeroDiscoveryStreak: 2 } }).maxZeroDiscoveryStreak,
    DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak,
  );
});

// ---------------------------------------------------------------------------
// Zero-discovery streak accounting
// ---------------------------------------------------------------------------

test("streak: a boundary-reached run with no new items increments", () => {
  assert.equal(nextZeroDiscoveryStreak({ previousStreak: 3, boundaryReached: true, newlyDiscovered: 0 }), 4);
});

test("streak: any new discovery resets to zero", () => {
  assert.equal(nextZeroDiscoveryStreak({ previousStreak: 7, boundaryReached: true, newlyDiscovered: 1 }), 0);
});

test("streak: a mid-scan run (boundary not reached) leaves the streak unchanged", () => {
  assert.equal(nextZeroDiscoveryStreak({ previousStreak: 5, boundaryReached: false, newlyDiscovered: 0 }), 5);
});

test("streak: sustained zero-discovery runs accumulate to the demotion threshold (AC3)", () => {
  let streak = 0;
  for (let i = 0; i < DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak; i++) {
    streak = nextZeroDiscoveryStreak({ previousStreak: streak, boundaryReached: true, newlyDiscovered: 0 });
  }
  assert.equal(streak, DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak);
  const decision = decideDegradation({
    lifecycleMode: M.ACTIVE,
    zeroDiscoveryStreak: streak,
    watermarkStallMs: null,
    consecutiveFailures: 0,
  });
  assert.equal(decision.action, "demote-to-shadow");
});

// ---------------------------------------------------------------------------
// AC4: no URL / content / secret leaks into the metric summary
// ---------------------------------------------------------------------------

test("AC4: the metric summary exposes only ids/counts/statuses/durations", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: { [S.DISCOVERED]: 2, [S.INGESTED]: 5 },
    publicationToDiscoveryDelaysMs: [1000, 2000],
    volume: { recentDayCount: 3, baselineDailyMean: 2 },
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /https?:\/\//, "no URLs");
  assert.doesNotMatch(serialized, /provisionalKey|canonicalKey|checkpointCursor|leaseOwner/, "no identity/lease keys");
  assert.doesNotMatch(serialized, /password|secret|token|apiKey/i, "no credential-like fields");
  // Every own key maps to a controlled primitive/enum/duration or a nested
  // counts/percentile object — never a free-form string blob.
  assert.ok(typeof summary.status === "string");
  assert.ok(typeof summary.totalCandidates === "number");
});

// ---------------------------------------------------------------------------
// #1094 rate-governor visibility (AC4): backoff/pause/budget without URLs
// ---------------------------------------------------------------------------

test("governor: an active hostname pause surfaces and flips a healthy source to partial", () => {
  const pausedUntil = new Date(NOW.getTime() + 45_000);
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: { [S.INGESTED]: 5 },
    governor: {
      hostPausedUntil: pausedUntil,
      hostConsecutiveErrors: 3,
      hostLastFailureReason: "http_429",
      discoveryBudgetExhausted: false,
      bodyBudgetExhausted: false,
      aiBudgetExhausted: false,
      backlogThrottleActive: false,
      backlogAlert: false,
      backlogUtilization: null,
    },
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.hostPauseActive, true);
  assert.equal(summary.hostPauseSeconds, 45);
  assert.equal(summary.hostConsecutiveErrors, 3);
  assert.equal(summary.hostLastFailureReason, "http_429");
});

test("governor: an expired pause is inactive and does not change status", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: { [S.INGESTED]: 5 },
    governor: {
      hostPausedUntil: new Date(NOW.getTime() - 1),
      hostConsecutiveErrors: 0,
      hostLastFailureReason: null,
      discoveryBudgetExhausted: false,
      bodyBudgetExhausted: false,
      aiBudgetExhausted: false,
      backlogThrottleActive: false,
      backlogAlert: false,
      backlogUtilization: null,
    },
  });
  assert.equal(summary.hostPauseActive, false);
  assert.equal(summary.hostPauseSeconds, null);
  assert.equal(summary.status, "healthy-caught-up");
});

test("governor: budget-exhaustion + backlog signals surface as controlled booleans (no URLs)", () => {
  const summary = computeSourceMetrics({
    now: NOW,
    source: snapshot(),
    candidateCounts: { [S.QUEUED]: 4 },
    governor: {
      hostPausedUntil: null,
      hostConsecutiveErrors: 0,
      hostLastFailureReason: null,
      discoveryBudgetExhausted: false,
      bodyBudgetExhausted: true,
      aiBudgetExhausted: true,
      backlogThrottleActive: true,
      backlogAlert: true,
      backlogUtilization: 0.9,
    },
  });
  assert.equal(summary.bodyBudgetExhausted, true);
  assert.equal(summary.aiBudgetExhausted, true);
  assert.equal(summary.backlogThrottleActive, true);
  assert.equal(summary.backlogAlert, true);
  assert.equal(summary.backlogUtilization, 0.9);
  assert.doesNotMatch(JSON.stringify(summary), /https?:\/\//);
});
