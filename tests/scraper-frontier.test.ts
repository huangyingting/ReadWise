/**
 * Pure frontier-logic tests for stateful incremental provider ingestion
 * (issue #1086, Phase 1.6).
 *
 * The module under test (`src/lib/scraper/incremental/frontier.ts`) is PURE — no
 * network, no DB. These deterministic, table-driven tests cover EVERY scenario
 * the issue lists so a timestamp or an HTTP validator can never be treated as
 * proof that no provider article was missed:
 *
 *   - compound watermark (same-timestamp, out-of-order, delayed/late entries),
 *   - future dates beyond clock tolerance and conflicting dates by precedence,
 *   - a ten-day outage (window measured from the watermark, NOT wall-clock),
 *   - a native cursor vs. overlap / consecutive-empty-page termination,
 *   - a rolled feed window producing a durable, visible gap,
 *   - validator calibration / a bad long-lived `304` (no real network — the
 *     conditional vs. unconditional results are passed in directly),
 *   - run-completion accounting (a partial/failed page cannot mark caught up).
 *
 * The compound-watermark <-> classify interplay is also asserted against the
 * real `classifyPage` so a same-timestamp new identity is never silently
 * skipped by the frontier window.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CandidateDateProvenance,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
} from "@prisma/client";

import {
  calibrateValidator,
  computeNextWatermark,
  decidePagination,
  decideRunCompletion,
  detectGap,
  overlapWindowStart,
  type CompoundWatermark,
  type WatermarkObservation,
} from "@/lib/scraper/incremental/frontier";
import { classifyPage } from "@/lib/scraper/incremental/classify";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";
import { identityVersionToInt } from "@/lib/scraper/incremental/baseline-backfill";

const FEED = CandidateDateProvenance.FEED;
const PAGE_METADATA = CandidateDateProvenance.PAGE_METADATA;
const URL_PROV = CandidateDateProvenance.URL;
const HTTP_HEADER = CandidateDateProvenance.HTTP_HEADER;
const INFERRED = CandidateDateProvenance.INFERRED;

const NOW = new Date("2024-07-01T00:00:00.000Z");

function obs(
  key: string,
  publishedAt: string,
  provenance: CandidateDateProvenance = FEED,
  sourceRank?: number,
): WatermarkObservation {
  return { key, publishedAt: new Date(publishedAt), provenance, ...(sourceRank != null ? { sourceRank } : {}) };
}

// ---------------------------------------------------------------------------
// Compound watermark advancement.
// ---------------------------------------------------------------------------

test("watermark: advances from null to the max eligible compound (at, key)", () => {
  const result = computeNextWatermark(null, [
    obs("k-b", "2024-06-10T00:00:00.000Z"),
    obs("k-a", "2024-06-12T00:00:00.000Z"),
  ], { now: NOW });
  assert.equal(result.advanced, true);
  assert.equal(result.next?.at.toISOString(), "2024-06-12T00:00:00.000Z");
  assert.equal(result.next?.key, "k-a");
});

test("watermark: same-timestamp items advance the KEY to the max (no silent skip)", () => {
  const result = computeNextWatermark(null, [
    obs("k-a", "2024-06-10T00:00:00.000Z"),
    obs("k-c", "2024-06-10T00:00:00.000Z"),
    obs("k-b", "2024-06-10T00:00:00.000Z"),
  ], { now: NOW });
  assert.equal(result.next?.at.toISOString(), "2024-06-10T00:00:00.000Z");
  assert.equal(result.next?.key, "k-c", "compound key breaks the same-timestamp tie");
});

test("watermark: out-of-order input still yields the max compound", () => {
  const result = computeNextWatermark(null, [
    obs("k-1", "2024-06-15T00:00:00.000Z"),
    obs("k-2", "2024-06-02T00:00:00.000Z"),
    obs("k-3", "2024-06-20T00:00:00.000Z"),
    obs("k-4", "2024-06-09T00:00:00.000Z"),
  ], { now: NOW });
  assert.equal(result.next?.at.toISOString(), "2024-06-20T00:00:00.000Z");
  assert.equal(result.next?.key, "k-3");
});

test("watermark: never regresses below the proven watermark", () => {
  const current: CompoundWatermark = { at: new Date("2024-06-15T00:00:00.000Z"), key: "k-hi" };
  const result = computeNextWatermark(current, [
    obs("k-old", "2024-06-01T00:00:00.000Z"),
    obs("k-old2", "2024-05-01T00:00:00.000Z"),
  ], { now: NOW });
  assert.equal(result.advanced, false);
  assert.equal(result.next, current, "a delayed older entry never rewinds the watermark");
});

test("watermark: a delayed entry AFTER the watermark advances it", () => {
  const current: CompoundWatermark = { at: new Date("2024-06-15T00:00:00.000Z"), key: "k-hi" };
  const result = computeNextWatermark(current, [obs("k-new", "2024-06-16T00:00:00.000Z")], { now: NOW });
  assert.equal(result.advanced, true);
  assert.equal(result.next?.at.toISOString(), "2024-06-16T00:00:00.000Z");
});

test("watermark: same-timestamp tie only advances when the key is strictly greater", () => {
  const current: CompoundWatermark = { at: new Date("2024-06-15T00:00:00.000Z"), key: "k-m" };
  const lower = computeNextWatermark(current, [obs("k-a", "2024-06-15T00:00:00.000Z")], { now: NOW });
  assert.equal(lower.advanced, false, "same ts, smaller key must not advance");
  const higher = computeNextWatermark(current, [obs("k-z", "2024-06-15T00:00:00.000Z")], { now: NOW });
  assert.equal(higher.advanced, true, "same ts, greater key advances");
  assert.equal(higher.next?.key, "k-z");
});

// ---------------------------------------------------------------------------
// Provenance gating: sitemap-lastmod / URL-inferred cannot advance a watermark.
// ---------------------------------------------------------------------------

for (const provenance of [URL_PROV, HTTP_HEADER, INFERRED, CandidateDateProvenance.UNKNOWN]) {
  test(`watermark: ${provenance} date is ineligible and cannot advance the watermark`, () => {
    const result = computeNextWatermark(null, [obs("k", "2024-06-20T00:00:00.000Z", provenance)], { now: NOW });
    assert.equal(result.advanced, false);
    assert.equal(result.next, null);
    assert.equal(result.ineligible, 1);
  });
}

test("watermark: FEED and PAGE_METADATA are eligible; mixed batch ignores ineligible ones", () => {
  const result = computeNextWatermark(null, [
    obs("k-url", "2024-06-30T00:00:00.000Z", URL_PROV), // newest but ineligible
    obs("k-feed", "2024-06-10T00:00:00.000Z", FEED),
    obs("k-page", "2024-06-20T00:00:00.000Z", PAGE_METADATA),
  ], { now: NOW });
  assert.equal(result.next?.at.toISOString(), "2024-06-20T00:00:00.000Z", "ignores the newer URL-inferred date");
  assert.equal(result.next?.key, "k-page");
  assert.equal(result.ineligible, 1);
});

test("watermark: empty eligibleProvenances disables date-watermark advancement", () => {
  const result = computeNextWatermark(null, [obs("k", "2024-06-20T00:00:00.000Z", FEED)], {
    now: NOW,
    policy: { eligibleProvenances: [] },
  });
  assert.equal(result.advanced, false);
  assert.equal(result.ineligible, 1);
});

// ---------------------------------------------------------------------------
// Future dates and trusted-date conflicts remain anomalies.
// ---------------------------------------------------------------------------

test("watermark: a future date beyond clock tolerance is rejected as an anomaly", () => {
  const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(); // +1h
  const result = computeNextWatermark(null, [
    obs("k-future", future),
    obs("k-ok", "2024-06-10T00:00:00.000Z"),
  ], { now: NOW });
  assert.equal(result.futureRejected, 1);
  assert.equal(result.next?.key, "k-ok", "the future item never advances the watermark");
});

test("watermark: a near-future date within tolerance is accepted", () => {
  const nearFuture = new Date(NOW.getTime() + 60 * 1000).toISOString(); // +1m < 5m tolerance
  const result = computeNextWatermark(null, [obs("k", nearFuture)], { now: NOW });
  assert.equal(result.futureRejected, 0);
  assert.equal(result.advanced, true);
});

test("watermark: conflicting dates for one identity are resolved by source precedence", () => {
  const result = computeNextWatermark(null, [
    obs("k-x", "2024-06-01T00:00:00.000Z", FEED, 1),
    obs("k-x", "2024-06-20T00:00:00.000Z", FEED, 5), // higher precedence wins
  ], { now: NOW });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.next?.at.toISOString(), "2024-06-20T00:00:00.000Z");
});

test("watermark: an UNRESOLVED conflict (equal precedence, differing dates) is an anomaly", () => {
  const result = computeNextWatermark(null, [
    obs("k-x", "2024-06-01T00:00:00.000Z", FEED, 2),
    obs("k-x", "2024-06-20T00:00:00.000Z", FEED, 2),
    obs("k-y", "2024-06-05T00:00:00.000Z", FEED),
  ], { now: NOW });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].key, "k-x");
  assert.equal(result.next?.key, "k-y", "the conflicted identity contributes no date");
});

test("watermark: blockedAbove holds observations back so a gap is not leapfrogged", () => {
  const blockedAbove = new Date("2024-06-10T00:00:00.000Z");
  const result = computeNextWatermark(null, [
    obs("k-below", "2024-06-05T00:00:00.000Z"),
    obs("k-above", "2024-06-15T00:00:00.000Z"),
  ], { now: NOW, blockedAbove });
  assert.equal(result.next?.at.toISOString(), "2024-06-05T00:00:00.000Z", "does not jump past the gap boundary");
});

// ---------------------------------------------------------------------------
// Ten-day outage: window is measured from the watermark, NOT wall-clock.
// ---------------------------------------------------------------------------

test("outage: all observable identities after the last watermark are accepted after a 10-day gap", () => {
  const watermark: CompoundWatermark = { at: new Date("2024-06-01T00:00:00.000Z"), key: "k-base" };
  // Wall-clock recovery is 10 days later, but the frontier window is the
  // watermark — every item published after it is still eligible.
  const recovered = new Date("2024-06-11T00:00:00.000Z");
  const items = [
    { url: undarkUrl("d1"), publishedAt: new Date("2024-06-02T00:00:00.000Z") },
    { url: undarkUrl("d2"), publishedAt: new Date("2024-06-05T00:00:00.000Z") },
    { url: undarkUrl("d3"), publishedAt: new Date("2024-06-09T00:00:00.000Z") },
  ];
  const classified = classifyPage(
    items.map((i) => ({ url: i.url, publishedAt: i.publishedAt, dateProvenance: FEED })),
    {
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
      windowStart: watermark.at,
      windowKey: watermark.key,
      knownIdentityKeys: new Set(),
    },
  );
  assert.deepEqual(
    classified.map((c) => c.outcome),
    ["eligible", "eligible", "eligible"],
    "the late window is measured from the watermark, not wall-clock recovery",
  );
  // And the watermark advances to the newest observed item (well before `recovered`).
  const advance = computeNextWatermark(
    watermark,
    items.map((i, idx) => obs(`k-${idx}`, i.publishedAt.toISOString())),
    { now: recovered },
  );
  assert.equal(advance.next?.at.toISOString(), "2024-06-09T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// classify interplay: a same-timestamp NEW identity is NOT silently skipped.
// ---------------------------------------------------------------------------

test("classify + compound watermark: a same-timestamp new identity stays eligible", () => {
  const at = new Date("2024-06-15T00:00:00.000Z");
  const knownUrl = undarkUrl("known");
  const newUrl = undarkUrl("fresh");
  const knownKey = deriveProvisionalIdentity(knownUrl).key;
  const newKey = deriveProvisionalIdentity(newUrl).key;
  // Watermark sits exactly at `at` with the known item's key.
  const [lo, hi] = knownKey < newKey ? [knownKey, newKey] : [newKey, knownKey];
  const windowKey = lo;
  const freshUrl = lo === knownKey ? newUrl : knownUrl; // the greater-key URL is the "new" one
  const classified = classifyPage(
    [{ url: freshUrl, publishedAt: at, dateProvenance: FEED }],
    {
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
      windowStart: at,
      windowKey,
      knownIdentityKeys: new Set(),
    },
  );
  assert.equal(classified[0].outcome, "eligible", "same-timestamp item with a greater key is in-window");
  assert.equal(hi > lo, true);
});

test("classify: without a compound key the window stays a pure timestamp bound (#1085)", () => {
  const at = new Date("2024-06-15T00:00:00.000Z");
  const classified = classifyPage(
    [{ url: undarkUrl("boundary"), publishedAt: at, dateProvenance: FEED }],
    {
      lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
      windowStart: at,
      knownIdentityKeys: new Set(),
    },
  );
  assert.equal(classified[0].outcome, "outside-window", "at-boundary is exclusive without a compound key");
});

// ---------------------------------------------------------------------------
// Overlap / pagination termination.
// ---------------------------------------------------------------------------

test("pagination: a native cursor keeps going until the boundary is reached", () => {
  assert.deepEqual(
    decidePagination({ newIdentityCount: 0, consecutiveEmptyPages: 3, hasCursor: true, boundaryReached: false }),
    { action: "continue", reason: "cursor" },
  );
  assert.deepEqual(
    decidePagination({ newIdentityCount: 0, consecutiveEmptyPages: 3, hasCursor: true, boundaryReached: true }),
    { action: "stop", reason: "boundary" },
  );
});

test("pagination: one empty page is INSUFFICIENT to stop (needs the consecutive threshold)", () => {
  const decision = decidePagination(
    { newIdentityCount: 0, consecutiveEmptyPages: 1, hasCursor: false, boundaryReached: false },
    { consecutiveEmptyPages: 2 },
  );
  assert.deepEqual(decision, { action: "continue", reason: "insufficient-empty-streak" });
});

test("pagination: stops as caught-up only after the configured consecutive empty pages", () => {
  const decision = decidePagination(
    { newIdentityCount: 0, consecutiveEmptyPages: 2, hasCursor: false, boundaryReached: false },
    { consecutiveEmptyPages: 2 },
  );
  assert.deepEqual(decision, { action: "stop", reason: "caught-up" });
});

test("pagination: a page with any new identity resets and continues (one old date is not enough)", () => {
  const decision = decidePagination(
    { newIdentityCount: 1, consecutiveEmptyPages: 0, hasCursor: false, boundaryReached: false },
    { consecutiveEmptyPages: 2 },
  );
  assert.deepEqual(decision, { action: "continue", reason: "new-identities" });
});

test("overlap: window start is shifted below the watermark by the overlap depth", () => {
  const watermark: CompoundWatermark = { at: new Date("2024-06-20T00:00:00.000Z"), key: "k" };
  const recent = [
    new Date("2024-06-20T00:00:00.000Z"),
    new Date("2024-06-19T00:00:00.000Z"),
    new Date("2024-06-18T00:00:00.000Z"),
    new Date("2024-06-17T00:00:00.000Z"),
  ];
  const start = overlapWindowStart(watermark, recent, { overlapSize: 3 });
  assert.equal(start?.toISOString(), "2024-06-18T00:00:00.000Z", "3rd most-recent becomes the re-scan floor");
});

test("overlap: never moves the window forward past the proven watermark", () => {
  const watermark: CompoundWatermark = { at: new Date("2024-06-10T00:00:00.000Z"), key: "k" };
  const recent = [new Date("2024-06-20T00:00:00.000Z"), new Date("2024-06-19T00:00:00.000Z")];
  const start = overlapWindowStart(watermark, recent, { overlapSize: 1 });
  assert.equal(start?.toISOString(), watermark.at.toISOString());
});

test("overlap: null watermark yields a null (no lower bound) window start", () => {
  assert.equal(overlapWindowStart(null, [new Date()], { overlapSize: 5 }), null);
});

// ---------------------------------------------------------------------------
// Gap detection: a rolled feed window is durable + visible.
// ---------------------------------------------------------------------------

test("gap: NONE when the window still reaches at/below the proven boundary", () => {
  const decision = detectGap({
    provenBoundary: new Date("2024-06-01T00:00:00.000Z"),
    windowOldest: new Date("2024-05-20T00:00:00.000Z"),
    boundaryReached: true,
  });
  assert.equal(decision.state, DiscoveryGapState.NONE);
  assert.equal(decision.note, null);
});

test("gap: DETECTED when the feed rolled past the proven boundary, with a redacted note", () => {
  const decision = detectGap({
    provenBoundary: new Date("2024-06-01T00:00:00.000Z"),
    windowOldest: new Date("2024-06-10T00:00:00.000Z"),
    boundaryReached: true,
    sourceLabel: "https://user:pw@undark.org/feed?token=secret#frag",
  });
  assert.equal(decision.state, DiscoveryGapState.DETECTED);
  assert.ok(decision.note && decision.note.includes("manual-backfill-suggested"));
  assert.ok(decision.note && !decision.note.includes("secret"), "the note redacts the URL query/userinfo");
  assert.ok(decision.note && !decision.note.includes("pw"), "the note redacts userinfo");
});

test("gap: SUSPECTED when the oldest item is unknown and the boundary was not reached", () => {
  const decision = detectGap({
    provenBoundary: new Date("2024-06-01T00:00:00.000Z"),
    windowOldest: null,
    boundaryReached: false,
  });
  assert.equal(decision.state, DiscoveryGapState.SUSPECTED);
  assert.ok(decision.note && decision.note.includes("completeness-suspected"));
});

test("gap: NONE with no proven boundary yet (nothing to have rolled past)", () => {
  const decision = detectGap({ provenBoundary: null, windowOldest: new Date(), boundaryReached: true });
  assert.equal(decision.state, DiscoveryGapState.NONE);
});

// ---------------------------------------------------------------------------
// Validator calibration: a bad long-lived 304 cannot suppress discovery.
// ---------------------------------------------------------------------------

test("calibration: a 304 disproven by new identities disables the validator and alerts", () => {
  const decision = calibrateValidator({
    conditionalReportedNotModified: true,
    unconditionalNewIdentityCount: 3,
    calibrationCompleted: true,
  });
  assert.equal(decision.disableValidator, true);
  assert.equal(decision.alert, true);
  assert.equal(decision.reason, "validator-stale-304-with-new-identities");
});

test("calibration: a consistent 304 (unconditional finds nothing new) keeps the validator", () => {
  const decision = calibrateValidator({
    conditionalReportedNotModified: true,
    unconditionalNewIdentityCount: 0,
    calibrationCompleted: true,
  });
  assert.equal(decision.disableValidator, false);
  assert.equal(decision.reason, "validator-consistent");
});

test("calibration: an incomplete calibration proves nothing and never disables the validator", () => {
  const decision = calibrateValidator({
    conditionalReportedNotModified: true,
    unconditionalNewIdentityCount: 5,
    calibrationCompleted: false,
  });
  assert.equal(decision.disableValidator, false);
  assert.equal(decision.reason, "calibration-incomplete");
});

// ---------------------------------------------------------------------------
// Run-completion accounting: a partial/failed page cannot mark caught up.
// ---------------------------------------------------------------------------

test("run completion: caught up only when the boundary was reached AND all pages processed", () => {
  assert.equal(
    decideRunCompletion({ boundaryReached: true, pagesFullyProcessed: true }).caughtUp,
    true,
  );
  assert.equal(decideRunCompletion({ boundaryReached: true, pagesFullyProcessed: true }).health, DiscoverySourceHealth.HEALTHY);
});

test("run completion: a partial page (boundary not reached) is NOT caught up", () => {
  const decision = decideRunCompletion({ boundaryReached: false, pagesFullyProcessed: true });
  assert.equal(decision.caughtUp, false);
  assert.equal(decision.health, DiscoverySourceHealth.DEGRADED);
});

test("run completion: a failed page (not fully processed) is NOT caught up even at the boundary", () => {
  assert.equal(
    decideRunCompletion({ boundaryReached: true, pagesFullyProcessed: false }).caughtUp,
    false,
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A unique, admissible undark article URL (real provider key). */
function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

// Sanity: the identity mapping used above matches the shared helpers.
test("helper: undark URLs derive a real provider identity", () => {
  const identity = deriveProvisionalIdentity(undarkUrl("x"));
  assert.equal(identity.providerKey, "undark");
  assert.equal(identityVersionToInt(identity.identityVersion), 1);
});
