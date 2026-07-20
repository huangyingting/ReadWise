/**
 * Pure-helper unit tests for the rescrape-regen reconciler (#1132).
 *
 * These exercise the injectable/pure surface only (limit clamp + grace cutoff) —
 * no database — so they run fast under plain `npm test`. The persistence + sweep
 * behaviour is covered by tests/db/rescrape-regen-reconcile.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampReconcileLimit,
  reconcileStampCutoff,
  RECONCILE_DEFAULT_LIMIT,
  RECONCILE_MAX_LIMIT,
  RECONCILE_GRACE_MS,
} from "@/lib/scraper/incremental/rescrape-regen-reconcile";

test("clampReconcileLimit falls back to the default for missing/invalid input", () => {
  assert.equal(clampReconcileLimit(undefined), RECONCILE_DEFAULT_LIMIT);
  assert.equal(clampReconcileLimit(0), RECONCILE_DEFAULT_LIMIT);
  assert.equal(clampReconcileLimit(-5), RECONCILE_DEFAULT_LIMIT);
  assert.equal(clampReconcileLimit(Number.NaN), RECONCILE_DEFAULT_LIMIT);
  assert.equal(clampReconcileLimit(Number.POSITIVE_INFINITY), RECONCILE_DEFAULT_LIMIT);
});

test("clampReconcileLimit floors and bounds positive input", () => {
  assert.equal(clampReconcileLimit(1), 1);
  assert.equal(clampReconcileLimit(5), 5);
  assert.equal(clampReconcileLimit(5.9), 5);
  assert.equal(clampReconcileLimit(RECONCILE_MAX_LIMIT + 1000), RECONCILE_MAX_LIMIT);
});

test("reconcileStampCutoff subtracts exactly the grace window", () => {
  const now = new Date("2026-07-20T10:00:00.000Z");
  const cutoff = reconcileStampCutoff(now);
  assert.equal(cutoff.getTime(), now.getTime() - RECONCILE_GRACE_MS);
  // Purity: the input Date is not mutated.
  assert.equal(now.toISOString(), "2026-07-20T10:00:00.000Z");
});
