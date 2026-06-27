/**
 * Today Session — controlled-value validators and id coercion (#789).
 * Pure module: no Prisma, no mocks required.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTodaySessionStatus,
  isTodaySessionSource,
  isTodayCompletionTier,
  isTodayGenerationReasonCode,
  isTodaySkipReason,
  assertControlledValue,
  toIdArray,
  TODAY_SESSION_STATUSES,
  TODAY_SKIP_REASONS,
} from "@/lib/engagement/today-session/types";

test("status validator accepts known values and rejects others", () => {
  assert.equal(isTodaySessionStatus("active"), true);
  assert.equal(isTodaySessionStatus("completed"), true);
  assert.equal(isTodaySessionStatus("skipped"), true);
  assert.equal(isTodaySessionStatus("bogus"), false);
  assert.equal(isTodaySessionStatus(""), false);
  assert.equal(isTodaySessionStatus(null), false);
  assert.equal(isTodaySessionStatus(42), false);
});

test("source validator", () => {
  for (const v of ["resume", "picks", "none"]) {
    assert.equal(isTodaySessionSource(v), true);
  }
  assert.equal(isTodaySessionSource("rss"), false);
});

test("completion tier validator", () => {
  for (const v of ["none", "reading", "comprehension", "full"]) {
    assert.equal(isTodayCompletionTier(v), true);
  }
  assert.equal(isTodayCompletionTier("partial"), false);
});

test("generation reason validator", () => {
  for (const v of ["resume_in_progress", "picks_primary", "no_candidate"]) {
    assert.equal(isTodayGenerationReasonCode(v), true);
  }
  assert.equal(isTodayGenerationReasonCode("magic"), false);
});

test("skip reason validator", () => {
  for (const v of TODAY_SKIP_REASONS) {
    assert.equal(isTodaySkipReason(v), true);
  }
  assert.equal(isTodaySkipReason("dog_ate_it"), false);
});

test("assertControlledValue returns the value when valid", () => {
  assert.equal(
    assertControlledValue(TODAY_SESSION_STATUSES, "completed", "status"),
    "completed",
  );
});

test("assertControlledValue throws on invalid value", () => {
  assert.throws(
    () => assertControlledValue(TODAY_SESSION_STATUSES, "nope", "status"),
    /Invalid TodaySession status/,
  );
});

test("toIdArray keeps strings and drops non-strings / non-arrays", () => {
  assert.deepEqual(toIdArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(toIdArray(["a", 1, null, "b", {}]), ["a", "b"]);
  assert.deepEqual(toIdArray("not-an-array"), []);
  assert.deepEqual(toIdArray(null), []);
  assert.deepEqual(toIdArray(undefined), []);
});
