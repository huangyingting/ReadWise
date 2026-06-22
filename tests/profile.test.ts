import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfileInput, parseTopics, isOnboarded } from "@/lib/profile";

test("parseProfileInput requires a valid English level", () => {
  assert.equal(parseProfileInput({}).ok, false);
  assert.equal(parseProfileInput({ englishLevel: "Z9" }).ok, false);
  const ok = parseProfileInput({ englishLevel: "B1" });
  assert.equal(ok.ok, true);
});

test("parseProfileInput validates age and gender when present", () => {
  assert.equal(
    parseProfileInput({ englishLevel: "B1", ageRange: "nope" }).ok,
    false,
  );
  assert.equal(
    parseProfileInput({ englishLevel: "B1", gender: "nope" }).ok,
    false,
  );
  const res = parseProfileInput({
    englishLevel: "B2",
    ageRange: "25-34",
    gender: "Female",
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.ageRange, "25-34");
    assert.equal(res.value.gender, "Female");
  }
  // "Other" is a valid gender option
  const resOther = parseProfileInput({ englishLevel: "B1", gender: "Other" });
  assert.equal(resOther.ok, true);
  if (resOther.ok) {
    assert.equal(resOther.value.gender, "Other");
  }
});

test("parseProfileInput keeps only valid category slugs and dedups", () => {
  const res = parseProfileInput({
    englishLevel: "C1",
    topics: ["tech", "tech", "not-a-category", 42, "world"],
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.value.topics.sort(), ["tech", "world"]);
  }
});

test("empty/blank optional fields normalize to null", () => {
  const res = parseProfileInput({ englishLevel: "A1", ageRange: "", gender: "" });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.ageRange, null);
    assert.equal(res.value.gender, null);
  }
});

test("parseTopics tolerates malformed JSON", () => {
  assert.deepEqual(parseTopics('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseTopics("not json"), []);
  assert.deepEqual(parseTopics(null), []);
  assert.deepEqual(parseTopics('{"a":1}'), []);
});

test("isOnboarded checks completedAt", () => {
  assert.equal(isOnboarded(null), false);
  assert.equal(isOnboarded({ completedAt: null } as never), false);
  assert.equal(isOnboarded({ completedAt: new Date() } as never), true);
});

test("parseProfileInput accepts valid dailyGoal values", () => {
  const r1 = parseProfileInput({ englishLevel: "B1", dailyGoal: 1 });
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.value.dailyGoal, 1);

  const r2 = parseProfileInput({ englishLevel: "B1", dailyGoal: 5 });
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value.dailyGoal, 5);

  const r3 = parseProfileInput({ englishLevel: "B1", dailyGoal: 10 });
  assert.equal(r3.ok, true);
  if (r3.ok) assert.equal(r3.value.dailyGoal, 10);
});

test("parseProfileInput rejects out-of-range and non-integer dailyGoal", () => {
  assert.equal(parseProfileInput({ englishLevel: "B1", dailyGoal: 0 }).ok, false);
  assert.equal(parseProfileInput({ englishLevel: "B1", dailyGoal: 11 }).ok, false);
  assert.equal(parseProfileInput({ englishLevel: "B1", dailyGoal: 1.5 }).ok, false);
  assert.equal(parseProfileInput({ englishLevel: "B1", dailyGoal: "5" }).ok, false);
});

test("parseProfileInput omits dailyGoal when not provided", () => {
  const res = parseProfileInput({ englishLevel: "B1" });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.dailyGoal, undefined);
});
