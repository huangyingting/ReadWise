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

type ControlledValueValidator = (value: unknown) => boolean;

function assertAcceptedValues(
  validator: ControlledValueValidator,
  values: readonly unknown[],
): void {
  for (const value of values) {
    assert.equal(validator(value), true);
  }
}

function assertRejectedValues(
  validator: ControlledValueValidator,
  values: readonly unknown[],
): void {
  for (const value of values) {
    assert.equal(validator(value), false);
  }
}

test("status validator accepts known values and rejects others", () => {
  assertAcceptedValues(isTodaySessionStatus, ["active", "completed", "skipped"]);
  assertRejectedValues(isTodaySessionStatus, ["bogus", "", null, 42]);
});

test("source validator", () => {
  assertAcceptedValues(isTodaySessionSource, ["resume", "picks", "none"]);
  assertRejectedValues(isTodaySessionSource, ["rss"]);
});

test("completion tier validator", () => {
  assertAcceptedValues(isTodayCompletionTier, [
    "none",
    "reading",
    "comprehension",
    "full",
  ]);
  assertRejectedValues(isTodayCompletionTier, ["partial"]);
});

test("generation reason validator", () => {
  assertAcceptedValues(isTodayGenerationReasonCode, [
    "resume_in_progress",
    "picks_primary",
    "no_candidate",
  ]);
  assertRejectedValues(isTodayGenerationReasonCode, ["magic"]);
});

test("skip reason validator", () => {
  assertAcceptedValues(isTodaySkipReason, TODAY_SKIP_REASONS);
  assertRejectedValues(isTodaySkipReason, ["dog_ate_it"]);
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
