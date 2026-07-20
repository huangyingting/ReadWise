/**
 * Pure-helper unit tests for the orphaned-narration reaper (#1131).
 *
 * These exercise the injectable/pure surface only (limit clamp + grace cutoff) —
 * no database — so they run fast under plain `npm test`. The persistence + reap
 * behaviour is covered by tests/db/orphan-narration-retention.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clampReapLimit,
  orphanNarrationCutoff,
  ORPHAN_NARRATION_GRACE_MS,
  REAP_DEFAULT_LIMIT,
  REAP_MAX_LIMIT,
} from "@/lib/media/orphan-narration-retention";

test("clampReapLimit falls back to the default for missing/invalid input", () => {
  assert.equal(clampReapLimit(undefined), REAP_DEFAULT_LIMIT);
  assert.equal(clampReapLimit(0), REAP_DEFAULT_LIMIT);
  assert.equal(clampReapLimit(-5), REAP_DEFAULT_LIMIT);
  assert.equal(clampReapLimit(Number.NaN), REAP_DEFAULT_LIMIT);
  assert.equal(clampReapLimit(Number.POSITIVE_INFINITY), REAP_DEFAULT_LIMIT);
});

test("clampReapLimit floors and bounds positive input", () => {
  assert.equal(clampReapLimit(1), 1);
  assert.equal(clampReapLimit(50), 50);
  assert.equal(clampReapLimit(50.9), 50);
  assert.equal(clampReapLimit(REAP_MAX_LIMIT + 1000), REAP_MAX_LIMIT);
});

test("orphanNarrationCutoff subtracts exactly the default grace window", () => {
  const now = new Date("2026-07-20T11:00:00.000Z");
  const cutoff = orphanNarrationCutoff(now);
  assert.equal(cutoff.getTime(), now.getTime() - ORPHAN_NARRATION_GRACE_MS);
  // Purity: the input Date is not mutated.
  assert.equal(now.toISOString(), "2026-07-20T11:00:00.000Z");
});

test("orphanNarrationCutoff honours an explicit grace override", () => {
  const now = new Date("2026-07-20T11:00:00.000Z");
  const graceMs = 5 * 60 * 1000;
  const cutoff = orphanNarrationCutoff(now, graceMs);
  assert.equal(cutoff.getTime(), now.getTime() - graceMs);
});
