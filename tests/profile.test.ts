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
