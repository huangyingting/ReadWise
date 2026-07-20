/**
 * Pure unit tests for the bounded historical-backfill policy (issue #1101).
 *
 * `backfill-policy.ts` is PURE — no DB/network/clock (`now` is injected). These
 * tests prove: (1) bounds clamping never lets an approval become an unbounded
 * archive crawl (item ceiling, window span, open/future edges, invalid input);
 * (2) reactivation eligibility honors the governing invariant (a known/deleted
 * Article is NEVER revived; only OBSERVED_BASELINE / OBSERVED_SHADOW are
 * targets); and (3) the pause/resume/cancel lifecycle is legal + idempotent and
 * never resurrects a terminal run.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import { BackfillRunStatus, CrawlCandidateStatus } from "@prisma/client";

import {
  BACKFILL_CONTROL_ACTIONS,
  BACKFILL_JOB_PRIORITY,
  decideBackfillLifecycle,
  decideBackfillReactivation,
  resolveEffectiveBackfillBounds,
  type BackfillBoundsConfig,
  type RequestedBackfillBounds,
} from "@/lib/scraper/incremental/backfill-policy";

const S = CrawlCandidateStatus;
const RS = BackfillRunStatus;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIG: BackfillBoundsConfig = { maxItemsCeiling: 5_000, maxWindowDays: 3_660 };

function req(overrides: Partial<RequestedBackfillBounds> = {}): RequestedBackfillBounds {
  return { windowStart: null, windowEnd: null, maxItems: 100, ...overrides };
}

// ---- constants ------------------------------------------------------------

test("backfill job priority is a strictly-negative band (always after real-time)", () => {
  assert.equal(BACKFILL_JOB_PRIORITY < 0, true);
  assert.equal(BACKFILL_JOB_PRIORITY, -100);
});

test("control action set is exactly pause/resume/cancel", () => {
  assert.deepEqual([...BACKFILL_CONTROL_ACTIONS], ["pause", "resume", "cancel"]);
});

// ---- resolveEffectiveBackfillBounds --------------------------------------

test("a fully-specified in-range request passes through unclamped (only defaulted end warns nothing)", () => {
  const windowStart = new Date("2026-01-01T00:00:00.000Z");
  const windowEnd = new Date("2026-02-01T00:00:00.000Z");
  const r = resolveEffectiveBackfillBounds(req({ windowStart, windowEnd, maxItems: 50 }), CONFIG, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.effective.maxItems, 50);
  assert.equal(r.effective.windowStart.getTime(), windowStart.getTime());
  assert.equal(r.effective.windowEnd.getTime(), windowEnd.getTime());
  assert.deepEqual(r.warnings, []);
});

test("maxItems above the ceiling is clamped DOWN with a warning", () => {
  const r = resolveEffectiveBackfillBounds(
    req({ windowStart: new Date("2026-06-01T00:00:00.000Z"), windowEnd: new Date("2026-07-01T00:00:00.000Z"), maxItems: 10_000 }),
    CONFIG,
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.effective.maxItems, 5_000);
  assert.equal(r.warnings.includes("clamped-max-items"), true);
});

test("non-integer or <1 maxItems is rejected (invalid-max-items)", () => {
  for (const maxItems of [0, -1, 1.5, Number.NaN]) {
    const r = resolveEffectiveBackfillBounds(req({ maxItems }), CONFIG, NOW);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "invalid-max-items");
  }
});

test("an open window end defaults to now (defaulted-window-end)", () => {
  const r = resolveEffectiveBackfillBounds(
    req({ windowStart: new Date("2026-07-10T00:00:00.000Z"), windowEnd: null }),
    CONFIG,
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.effective.windowEnd.getTime(), NOW.getTime());
  assert.equal(r.warnings.includes("defaulted-window-end"), true);
});

test("a future window end is pulled back to now (cannot backfill the future)", () => {
  const future = new Date(NOW.getTime() + 30 * DAY_MS);
  const r = resolveEffectiveBackfillBounds(
    req({ windowStart: new Date("2026-07-10T00:00:00.000Z"), windowEnd: future }),
    CONFIG,
    NOW,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.effective.windowEnd.getTime(), NOW.getTime());
  assert.equal(r.warnings.includes("defaulted-window-end"), true);
});

test("an open window start is bounded to the widest allowed span (clamped-window-span)", () => {
  const r = resolveEffectiveBackfillBounds(req({ windowStart: null, windowEnd: NOW }), CONFIG, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const span = r.effective.windowEnd.getTime() - r.effective.windowStart.getTime();
  assert.equal(span, CONFIG.maxWindowDays * DAY_MS);
  assert.equal(r.warnings.includes("clamped-window-span"), true);
});

test("a start older than the max span is pulled forward to end - maxWindowDays", () => {
  const windowEnd = new Date("2026-07-01T00:00:00.000Z");
  const tooOld = new Date(windowEnd.getTime() - (CONFIG.maxWindowDays + 500) * DAY_MS);
  const r = resolveEffectiveBackfillBounds(req({ windowStart: tooOld, windowEnd }), CONFIG, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.effective.windowStart.getTime(), windowEnd.getTime() - CONFIG.maxWindowDays * DAY_MS);
  assert.equal(r.warnings.includes("clamped-window-span"), true);
});

test("start after end is rejected (invalid-window-order)", () => {
  const r = resolveEffectiveBackfillBounds(
    req({ windowStart: new Date("2026-07-02T00:00:00.000Z"), windowEnd: new Date("2026-07-01T00:00:00.000Z") }),
    CONFIG,
    NOW,
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid-window-order");
});

test("the effective window is ALWAYS a concrete bounded interval within the span cap", () => {
  // Fully open request → both edges resolved, span never exceeds the ceiling.
  const r = resolveEffectiveBackfillBounds(req({ windowStart: null, windowEnd: null, maxItems: 1 }), CONFIG, NOW);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.effective.windowStart instanceof Date);
  assert.ok(r.effective.windowEnd instanceof Date);
  assert.ok(r.effective.windowEnd.getTime() - r.effective.windowStart.getTime() <= CONFIG.maxWindowDays * DAY_MS);
});

// ---- decideBackfillReactivation ------------------------------------------

test("a candidate that already links a public Article is NEVER reactivated (governing invariant)", () => {
  const d = decideBackfillReactivation({ status: S.BASELINE, observedInBaseline: true, hasArticle: true, hadArticleDeleted: false });
  assert.equal(d.eligible, false);
  assert.equal(d.eligible === false && d.reason, "has-article");
});

test("a candidate whose Article was created then deleted is NEVER revived", () => {
  const d = decideBackfillReactivation({ status: S.BASELINE, observedInBaseline: true, hasArticle: false, hadArticleDeleted: true });
  assert.equal(d.eligible, false);
  assert.equal(d.eligible === false && d.reason, "article-deleted");
});

test("OBSERVED_BASELINE (status BASELINE) is eligible with target observed-baseline", () => {
  const d = decideBackfillReactivation({ status: S.BASELINE, observedInBaseline: true, hasArticle: false, hadArticleDeleted: false });
  assert.equal(d.eligible, true);
  assert.equal(d.eligible === true && d.target, "observed-baseline");
});

test("OBSERVED_SHADOW (DISCOVERED + not observed-in-baseline) is eligible with target observed-shadow", () => {
  const d = decideBackfillReactivation({ status: S.DISCOVERED, observedInBaseline: false, hasArticle: false, hadArticleDeleted: false });
  assert.equal(d.eligible, true);
  assert.equal(d.eligible === true && d.target, "observed-shadow");
});

test("a DISCOVERED candidate already observed in baseline is NOT a shadow target", () => {
  const d = decideBackfillReactivation({ status: S.DISCOVERED, observedInBaseline: true, hasArticle: false, hadArticleDeleted: false });
  assert.equal(d.eligible, false);
  assert.equal(d.eligible === false && d.reason, "not-reactivatable");
});

test("SKIPPED_OUTSIDE_WINDOW is eligible with target skipped-outside-window (#1127)", () => {
  const d = decideBackfillReactivation({ status: S.SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, hasArticle: false, hadArticleDeleted: false });
  assert.equal(d.eligible, true);
  assert.equal(d.eligible === true && d.target, "skipped-outside-window");
});

test("SKIPPED_OUTSIDE_WINDOW still yields to the has-article / article-deleted invariant (precedence)", () => {
  const withArticle = decideBackfillReactivation({ status: S.SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, hasArticle: true, hadArticleDeleted: false });
  assert.equal(withArticle.eligible, false);
  assert.equal(withArticle.eligible === false && withArticle.reason, "has-article");

  const deleted = decideBackfillReactivation({ status: S.SKIPPED_OUTSIDE_WINDOW, observedInBaseline: false, hasArticle: false, hadArticleDeleted: true });
  assert.equal(deleted.eligible, false);
  assert.equal(deleted.eligible === false && deleted.reason, "article-deleted");
});

test("terminal / parked / already-queued statuses are never reactivatable", () => {
  for (const status of [S.QUEUED, S.INGESTING, S.INGESTED, S.SKIPPED, S.REJECTED, S.FAILED, S.CONFLICT, S.DUPLICATE_ALIAS, S.NEEDS_REVIEW, S.QUARANTINED, S.SKIPPED_REVIEW]) {
    const d = decideBackfillReactivation({ status, observedInBaseline: false, hasArticle: false, hadArticleDeleted: false });
    assert.equal(d.eligible, false, `expected ineligible for ${status}`);
    assert.equal(d.eligible === false && d.reason, "not-reactivatable");
  }
});

// ---- decideBackfillLifecycle ---------------------------------------------

test("pause: RUNNING→PAUSED applies; PAUSED is idempotent no-op; terminal illegal", () => {
  const apply = decideBackfillLifecycle(RS.RUNNING, "pause");
  assert.equal(apply.kind, "apply");
  assert.equal(apply.kind === "apply" && apply.toStatus, RS.PAUSED);

  const noop = decideBackfillLifecycle(RS.PAUSED, "pause");
  assert.equal(noop.kind, "noop");
  assert.equal(noop.kind === "noop" && noop.reason, "already-paused");

  for (const status of [RS.COMPLETED, RS.CANCELLED, RS.FAILED]) {
    const illegal = decideBackfillLifecycle(status, "pause");
    assert.equal(illegal.kind, "illegal");
    assert.equal(illegal.kind === "illegal" && illegal.reason, "not-active");
  }
});

test("resume: PAUSED→RUNNING applies; RUNNING is idempotent no-op; terminal illegal", () => {
  const apply = decideBackfillLifecycle(RS.PAUSED, "resume");
  assert.equal(apply.kind, "apply");
  assert.equal(apply.kind === "apply" && apply.toStatus, RS.RUNNING);

  const noop = decideBackfillLifecycle(RS.RUNNING, "resume");
  assert.equal(noop.kind, "noop");
  assert.equal(noop.kind === "noop" && noop.reason, "already-running");

  for (const status of [RS.COMPLETED, RS.CANCELLED, RS.FAILED]) {
    const illegal = decideBackfillLifecycle(status, "resume");
    assert.equal(illegal.kind, "illegal");
    assert.equal(illegal.kind === "illegal" && illegal.reason, "not-paused");
  }
});

test("cancel: RUNNING/PAUSED→CANCELLED applies; CANCELLED idempotent; COMPLETED/FAILED illegal", () => {
  for (const status of [RS.RUNNING, RS.PAUSED]) {
    const apply = decideBackfillLifecycle(status, "cancel");
    assert.equal(apply.kind, "apply");
    assert.equal(apply.kind === "apply" && apply.toStatus, RS.CANCELLED);
  }
  const noop = decideBackfillLifecycle(RS.CANCELLED, "cancel");
  assert.equal(noop.kind, "noop");
  assert.equal(noop.kind === "noop" && noop.reason, "already-cancelled");

  for (const status of [RS.COMPLETED, RS.FAILED]) {
    const illegal = decideBackfillLifecycle(status, "cancel");
    assert.equal(illegal.kind, "illegal");
    assert.equal(illegal.kind === "illegal" && illegal.reason, "already-terminal");
  }
});
