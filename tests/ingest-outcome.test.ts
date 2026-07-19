/**
 * Unit tests for the PURE ingest failure classification + retry scheduling +
 * reactivation selection (#1093, Phase 2.3). No DB / network / real clock — every
 * timing decision takes an injected `now` and injected random, so these stay
 * covered by the unit-only coverage gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INGEST_FAILURE_REASON,
  classifyIngestAttempt,
  computeNextAttemptAt,
  isReactivationEligible,
  selectReactivationEligible,
  withinPropagationGrace,
  type IngestScheduleConfig,
  type ReactivationCandidate,
} from "@/lib/scraper/incremental/ingest-outcome";

const T0 = new Date("2026-07-19T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function config(overrides: Partial<IngestScheduleConfig> = {}): IngestScheduleConfig {
  return {
    maxAttempts: 5,
    baseBackoffMs: 2000,
    maxBackoffMs: 5 * 60 * 1000,
    propagationGraceMs: 6 * HOUR,
    random: () => 0, // deterministic: zero jitter
    ...overrides,
  };
}

// --- AC1: 404 pre-propagation is a retry within grace ----------------------

test("AC1: a 404 within the propagation grace window is a transient RETRY (not terminal)", () => {
  const c = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 404 },
    now: new Date(T0.getTime() + 1 * HOUR),
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(c.disposition, "retry");
  assert.equal(c.reason, INGEST_FAILURE_REASON.HTTP_404_PRE_PROPAGATION);
  assert.ok(c.nextAttemptAt instanceof Date, "a retry schedules a next attempt");
});

test("AC1: a 404 AFTER the grace window quarantines (persistent not-found), never terminal", () => {
  const c = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 404 },
    now: new Date(T0.getTime() + 7 * HOUR),
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(c.disposition, "quarantine-on-exhaustion");
  assert.equal(c.reason, INGEST_FAILURE_REASON.HTTP_404_AFTER_GRACE);
  assert.equal(c.nextAttemptAt, undefined);
});

test("first attempt (firstAttemptAt null) treats now as the grace anchor → within grace", () => {
  assert.equal(withinPropagationGrace(null, T0, 6 * HOUR), true);
  const c = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 404 },
    now: T0,
    attemptNumber: 1,
    firstAttemptAt: null,
    config: config(),
  });
  assert.equal(c.reason, INGEST_FAILURE_REASON.HTTP_404_PRE_PROPAGATION);
});

// --- transient taxonomy → retry then quarantine on exhaustion --------------

test("transient network/http failures retry while attempts remain", () => {
  const transient = [
    { outcome: { kind: "fetch-timeout" } as const, reason: INGEST_FAILURE_REASON.FETCH_TIMEOUT },
    { outcome: { kind: "network-error" } as const, reason: INGEST_FAILURE_REASON.NETWORK_ERROR },
    { outcome: { kind: "http-error", status: 403 } as const, reason: INGEST_FAILURE_REASON.HTTP_403_TEMPORARY },
    { outcome: { kind: "http-error", status: 429 } as const, reason: INGEST_FAILURE_REASON.HTTP_429 },
    { outcome: { kind: "http-error", status: 503 } as const, reason: INGEST_FAILURE_REASON.HTTP_5XX },
    { outcome: { kind: "extraction-incomplete" } as const, reason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE },
  ];
  for (const { outcome, reason } of transient) {
    const c = classifyIngestAttempt({ outcome, now: T0, attemptNumber: 1, firstAttemptAt: T0, config: config() });
    assert.equal(c.disposition, "retry", `${reason} should retry`);
    assert.equal(c.reason, reason);
  }
});

test("transient failures quarantine once attempts are exhausted", () => {
  const c = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 503 },
    now: T0,
    attemptNumber: 5, // == maxAttempts
    firstAttemptAt: T0,
    config: config({ maxAttempts: 5 }),
  });
  assert.equal(c.disposition, "quarantine-on-exhaustion");
  assert.equal(c.reason, INGEST_FAILURE_REASON.HTTP_5XX);
});

// --- deterministic + permanent taxonomy ------------------------------------

test("quality rejection is deterministic → quarantine immediately (no retry)", () => {
  const c = classifyIngestAttempt({
    outcome: { kind: "quality-rejected" },
    now: T0,
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(c.disposition, "quarantine-on-exhaustion");
  assert.equal(c.reason, INGEST_FAILURE_REASON.QUALITY_REJECTED);
  assert.equal(c.nextAttemptAt, undefined);
});

test("410 Gone and access-restricted are IMMEDIATE terminal", () => {
  const gone = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 410 },
    now: T0,
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(gone.disposition, "terminal");
  assert.equal(gone.reason, INGEST_FAILURE_REASON.HTTP_410_GONE);

  const restricted = classifyIngestAttempt({
    outcome: { kind: "access-restricted" },
    now: T0,
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(restricted.disposition, "terminal");
  assert.equal(restricted.reason, INGEST_FAILURE_REASON.ACCESS_RESTRICTED);
});

test("other 4xx (e.g. 401/451) is a permanent client error → terminal", () => {
  for (const status of [400, 401, 451]) {
    const c = classifyIngestAttempt({
      outcome: { kind: "http-error", status },
      now: T0,
      attemptNumber: 1,
      firstAttemptAt: T0,
      config: config(),
    });
    assert.equal(c.disposition, "terminal", `HTTP ${status}`);
    assert.equal(c.reason, INGEST_FAILURE_REASON.HTTP_CLIENT_ERROR);
  }
});

// --- backoff + Retry-After scheduler ---------------------------------------

test("exponential backoff grows with attempt number (deterministic, zero jitter)", () => {
  const cfg = config();
  const at1 = computeNextAttemptAt({ attemptNumber: 1, now: T0, config: cfg }).getTime() - T0.getTime();
  const at2 = computeNextAttemptAt({ attemptNumber: 2, now: T0, config: cfg }).getTime() - T0.getTime();
  const at3 = computeNextAttemptAt({ attemptNumber: 3, now: T0, config: cfg }).getTime() - T0.getTime();
  assert.equal(at1, 2000);
  assert.equal(at2, 4000);
  assert.equal(at3, 8000);
});

test("backoff is capped at maxBackoffMs", () => {
  const cfg = config({ baseBackoffMs: 1000, maxBackoffMs: 3000 });
  const delay = computeNextAttemptAt({ attemptNumber: 10, now: T0, config: cfg }).getTime() - T0.getTime();
  assert.equal(delay, 3000);
});

test("a server Retry-After OVERRIDES the computed backoff", () => {
  const cfg = config();
  const next = computeNextAttemptAt({ attemptNumber: 1, now: T0, config: cfg, retryAfterMs: 90_000 });
  assert.equal(next.getTime() - T0.getTime(), 90_000);
});

test("classify threads Retry-After into the scheduled retry time", () => {
  const c = classifyIngestAttempt({
    outcome: { kind: "http-error", status: 429, retryAfterMs: 120_000 },
    now: T0,
    attemptNumber: 1,
    firstAttemptAt: T0,
    config: config(),
  });
  assert.equal(c.disposition, "retry");
  assert.equal(c.retryAfterMs, 120_000);
  assert.equal(c.nextAttemptAt?.getTime(), T0.getTime() + 120_000);
});

// --- AC4 (pure determinism): same inputs → identical classification --------

test("AC4: classification is deterministic for identical inputs (restart-safe)", () => {
  const args = {
    outcome: { kind: "http-error", status: 503 } as const,
    now: T0,
    attemptNumber: 2,
    firstAttemptAt: T0,
    config: config(),
  };
  assert.deepEqual(classifyIngestAttempt(args), classifyIngestAttempt(args));
});

// --- AC3: reactivation eligibility + budget --------------------------------

function reactivatable(overrides: Partial<ReactivationCandidate> = {}): ReactivationCandidate {
  return {
    id: "cand",
    status: "QUARANTINED",
    observedInBaseline: false,
    articleId: null,
    lastFailureReason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE,
    extractorVersion: 1,
    ...overrides,
  };
}

test("AC3: only QUARANTINED no-Article extraction/quality failures are reactivation-eligible", () => {
  assert.equal(isReactivationEligible(reactivatable(), 2), true);
  assert.equal(
    isReactivationEligible(reactivatable({ lastFailureReason: INGEST_FAILURE_REASON.QUALITY_REJECTED }), 2),
    true,
  );
});

test("AC3: prohibited candidates are NEVER reactivated (governing invariant)", () => {
  const prohibited: ReactivationCandidate[] = [
    reactivatable({ articleId: "article-1" }), // saved / existing / deleted Article
    reactivatable({ observedInBaseline: true }), // baseline identity
    reactivatable({ status: "INGESTED" }),
    reactivatable({ status: "REJECTED" }), // permanent 410 / access
    reactivatable({ status: "SKIPPED" }), // policy-skipped
    reactivatable({ status: "NEEDS_REVIEW" }),
    reactivatable({ status: "CONFLICT" }),
    reactivatable({ status: "DUPLICATE_ALIAS" }),
    reactivatable({ lastFailureReason: INGEST_FAILURE_REASON.HTTP_5XX }), // transient network, not extraction/quality
    reactivatable({ lastFailureReason: null }),
    reactivatable({ extractorVersion: 2 }), // already processed by the new extractor
    reactivatable({ extractorVersion: 3 }), // ahead of the new extractor
  ];
  for (const c of prohibited) {
    assert.equal(isReactivationEligible(c, 2), false, `${c.status}/${c.lastFailureReason}/art=${c.articleId}`);
  }
});

test("AC3: selection obeys the bounded budget and is deterministic (oldest first)", () => {
  const candidates: ReactivationCandidate[] = [
    reactivatable({ id: "c3", orderKey: 300 }),
    reactivatable({ id: "c1", orderKey: 100 }),
    reactivatable({ id: "c2", orderKey: 200 }),
    reactivatable({ id: "ineligible", status: "INGESTED", orderKey: 50 }),
  ];
  const selected = selectReactivationEligible(candidates, { newExtractorVersion: 2, budget: 2 });
  assert.deepEqual(selected.map((c) => c.id), ["c1", "c2"]);

  const zeroBudget = selectReactivationEligible(candidates, { newExtractorVersion: 2, budget: 0 });
  assert.deepEqual(zeroBudget, []);
});
