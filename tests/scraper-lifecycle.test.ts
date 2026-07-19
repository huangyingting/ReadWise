/**
 * Pure unit tests for the discovery-source lifecycle logic (issue #1088,
 * Phase 1.8).
 *
 * The module under test (`src/lib/scraper/incremental/lifecycle.ts`) is PURE — no
 * network, no DB, no clock. These table-driven tests cover the three lifecycle
 * decisions:
 *   - the SAFE state machine (`DISABLED → BASELINE → SHADOW → ACTIVE`, pause,
 *     resume, rollback, retire);
 *   - the baseline-completion gate (every observable segment must complete);
 *   - the activation catch-up selector (age + count limits, ordering,
 *     idempotency/determinism).
 * The `lifecycle-run-guard.ts` body-work refusal is covered here too.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { DiscoverySourceLifecycleMode } from "@prisma/client";

import {
  DEFAULT_CATCHUP_AGE_DAYS,
  DEFAULT_CATCHUP_MAX_COUNT,
  classifyLifecycleTransition,
  decideBaselineCompletion,
  isBodyWorkProhibited,
  isValidLifecycleTransition,
  selectActivationCatchUp,
  type BaselineSegmentState,
  type ShadowCatchUpCandidate,
} from "@/lib/scraper/incremental/lifecycle";
import {
  BodyWorkProhibitedError,
  assertBodyWorkAllowed,
  guardIngestPort,
} from "@/lib/scraper/incremental/lifecycle-run-guard";

const { DISABLED, BASELINE, SHADOW, ACTIVE, PAUSED, RETIRED } = DiscoverySourceLifecycleMode;

// ---------------------------------------------------------------------------
// State machine (table-driven)
// ---------------------------------------------------------------------------

const TRANSITION_CASES: Array<{
  from: DiscoverySourceLifecycleMode;
  to: DiscoverySourceLifecycleMode;
  kind: ReturnType<typeof classifyLifecycleTransition>;
}> = [
  // Forward progression.
  { from: DISABLED, to: BASELINE, kind: "forward" },
  { from: BASELINE, to: SHADOW, kind: "forward" },
  { from: SHADOW, to: ACTIVE, kind: "forward" },
  // Pause from any active-ish state.
  { from: BASELINE, to: PAUSED, kind: "pause" },
  { from: SHADOW, to: PAUSED, kind: "pause" },
  { from: ACTIVE, to: PAUSED, kind: "pause" },
  // Resume out of pause into any active-ish state.
  { from: PAUSED, to: BASELINE, kind: "resume" },
  { from: PAUSED, to: SHADOW, kind: "resume" },
  { from: PAUSED, to: ACTIVE, kind: "resume" },
  // Safe rollback one stage toward DISABLED.
  { from: ACTIVE, to: SHADOW, kind: "rollback" },
  { from: SHADOW, to: BASELINE, kind: "rollback" },
  { from: BASELINE, to: DISABLED, kind: "rollback" },
  // Retire any non-retired state.
  { from: DISABLED, to: RETIRED, kind: "retire" },
  { from: BASELINE, to: RETIRED, kind: "retire" },
  { from: ACTIVE, to: RETIRED, kind: "retire" },
  { from: PAUSED, to: RETIRED, kind: "retire" },
  // Invalid: skipping a stage.
  { from: DISABLED, to: SHADOW, kind: null },
  { from: DISABLED, to: ACTIVE, kind: null },
  { from: BASELINE, to: ACTIVE, kind: null },
  // Invalid: forward jump backward past one stage.
  { from: ACTIVE, to: BASELINE, kind: null },
  { from: ACTIVE, to: DISABLED, kind: null },
  { from: SHADOW, to: DISABLED, kind: null },
  // Invalid: no-op.
  { from: ACTIVE, to: ACTIVE, kind: null },
  { from: DISABLED, to: DISABLED, kind: null },
  // Invalid: RETIRED is terminal.
  { from: RETIRED, to: DISABLED, kind: null },
  { from: RETIRED, to: ACTIVE, kind: null },
  // Invalid: DISABLED cannot be paused (nothing to suspend).
  { from: DISABLED, to: PAUSED, kind: null },
  // Invalid: resume from pause to disabled is a rollback edge only.
  { from: PAUSED, to: DISABLED, kind: "rollback" },
];

for (const testCase of TRANSITION_CASES) {
  test(`transition ${testCase.from} → ${testCase.to} is ${testCase.kind ?? "invalid"}`, () => {
    assert.equal(classifyLifecycleTransition(testCase.from, testCase.to), testCase.kind);
    assert.equal(isValidLifecycleTransition(testCase.from, testCase.to), testCase.kind !== null);
  });
}

// ---------------------------------------------------------------------------
// Body-work prohibition
// ---------------------------------------------------------------------------

test("body work is prohibited in BASELINE and SHADOW, permitted elsewhere", () => {
  assert.equal(isBodyWorkProhibited(BASELINE), true);
  assert.equal(isBodyWorkProhibited(SHADOW), true);
  assert.equal(isBodyWorkProhibited(ACTIVE), false);
  assert.equal(isBodyWorkProhibited(DISABLED), false);
});

test("assertBodyWorkAllowed throws in shadow, passes when active", () => {
  assert.throws(() => assertBodyWorkAllowed(SHADOW, "fetch-body"), BodyWorkProhibitedError);
  assert.doesNotThrow(() => assertBodyWorkAllowed(ACTIVE, "fetch-body"));
});

test("guardIngestPort refuses in shadow WITHOUT calling the wrapped port", async () => {
  let called = 0;
  const port = guardIngestPort(SHADOW, "enqueue-ingest", async () => {
    called += 1;
    return "ran";
  });
  await assert.rejects(port(), BodyWorkProhibitedError);
  assert.equal(called, 0);
});

test("guardIngestPort delegates when body work is permitted", async () => {
  let called = 0;
  const port = guardIngestPort(ACTIVE, "enqueue-ingest", async (n: number) => {
    called += 1;
    return n * 2;
  });
  assert.equal(await port(21), 42);
  assert.equal(called, 1);
});

// ---------------------------------------------------------------------------
// Baseline-completion gate (table-driven)
// ---------------------------------------------------------------------------

function segment(id: string, boundaryReached: boolean, pagesFullyProcessed: boolean): BaselineSegmentState {
  return { segmentId: id, boundaryReached, pagesFullyProcessed };
}

test("baseline completes only when every segment reached boundary and committed", () => {
  const decision = decideBaselineCompletion({
    segments: [segment("a", true, true), segment("b", true, true)],
  });
  assert.equal(decision.complete, true);
  assert.deepEqual(decision.incompleteSegments, []);
});

test("baseline refuses completion when a segment did not reach its boundary", () => {
  const decision = decideBaselineCompletion({
    segments: [segment("a", true, true), segment("b", false, true)],
  });
  assert.equal(decision.complete, false);
  assert.deepEqual(decision.incompleteSegments, ["b"]);
});

test("baseline refuses completion when a segment did not commit its checkpoint", () => {
  const decision = decideBaselineCompletion({
    segments: [segment("a", true, false), segment("b", true, true)],
  });
  assert.equal(decision.complete, false);
  assert.deepEqual(decision.incompleteSegments, ["a"]);
});

test("baseline can never complete with zero segments (misconfiguration fails closed)", () => {
  const decision = decideBaselineCompletion({ segments: [] });
  assert.equal(decision.complete, false);
  assert.deepEqual(decision.incompleteSegments, []);
});

// ---------------------------------------------------------------------------
// Activation catch-up selector
// ---------------------------------------------------------------------------

const NOW = new Date("2024-07-15T00:00:00.000Z");

function candidate(
  id: string,
  daysAgo: number,
  overrides: Partial<ShadowCatchUpCandidate> = {},
): ShadowCatchUpCandidate {
  const firstObservedAt = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { id, provisionalKey: `v1:${id}`, firstObservedAt, ...overrides };
}

test("catch-up defaults are seven days and one hundred candidates", () => {
  assert.equal(DEFAULT_CATCHUP_AGE_DAYS, 7);
  assert.equal(DEFAULT_CATCHUP_MAX_COUNT, 100);
});

test("catch-up defers candidates older than the age window (either limit stops)", () => {
  const decision = selectActivationCatchUp(
    [candidate("recent", 2), candidate("old", 10), candidate("edge", 6)],
    { now: NOW },
  );
  // recent (2d) and edge (6d) are within 7 days; old (10d) is deferred.
  assert.deepEqual(new Set(decision.queue), new Set(["recent", "edge"]));
  assert.deepEqual(decision.deferred, ["old"]);
});

test("catch-up honors the count limit, keeping the NEWEST candidates", () => {
  const decision = selectActivationCatchUp(
    [candidate("d3", 3), candidate("d1", 1), candidate("d2", 2), candidate("d4", 4)],
    { now: NOW, limits: { maxCount: 2 } },
  );
  // Newest first: d1, d2 queued; d3, d4 deferred.
  assert.deepEqual(decision.queue, ["d1", "d2"]);
  assert.deepEqual(new Set(decision.deferred), new Set(["d3", "d4"]));
});

test("catch-up ordering is newest-first with provisionalKey as a stable tiebreak", () => {
  const sameDay = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
  const decision = selectActivationCatchUp(
    [
      { id: "z", provisionalKey: "v1:z", firstObservedAt: sameDay },
      { id: "a", provisionalKey: "v1:a", firstObservedAt: sameDay },
      { id: "m", provisionalKey: "v1:m", firstObservedAt: sameDay },
    ],
    { now: NOW },
  );
  assert.deepEqual(decision.queue, ["a", "m", "z"]);
});

test("catch-up prefers trustedPublishedAt over firstObservedAt for age", () => {
  const decision = selectActivationCatchUp(
    [
      // Observed recently, but the trusted publication date is old → deferred.
      candidate("stale-publish", 1, { trustedPublishedAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) }),
      candidate("fresh", 1),
    ],
    { now: NOW },
  );
  assert.deepEqual(decision.queue, ["fresh"]);
  assert.deepEqual(decision.deferred, ["stale-publish"]);
});

test("catch-up is deterministic: identical inputs yield identical selection", () => {
  const input = [candidate("d5", 5), candidate("d3", 3), candidate("d9", 9), candidate("d1", 1)];
  const a = selectActivationCatchUp(input, { now: NOW });
  const b = selectActivationCatchUp(input, { now: NOW });
  assert.deepEqual(a.queue, b.queue);
  assert.deepEqual(a.deferred, b.deferred);
});

test("catch-up on an empty candidate set queues nothing", () => {
  const decision = selectActivationCatchUp([], { now: NOW });
  assert.deepEqual(decision.queue, []);
  assert.deepEqual(decision.deferred, []);
});
