import { test } from "node:test";
import assert from "node:assert/strict";
import {
  string,
  nonEmptyString,
  number,
  clampedInt,
  boolean,
  oneOf,
  array,
  optional,
  object,
  idParams,
  queryString,
  queryInt,
} from "@/lib/validation";

test("string trims and enforces bounds", () => {
  const s = string({ min: 2, max: 4 });
  assert.deepEqual(s("  ab  "), { ok: true, value: "ab" });
  assert.equal(s("a").ok, false);
  assert.equal(s("abcde").ok, false);
  assert.equal(s(123).ok, false);
});

test("nonEmptyString rejects empty / whitespace", () => {
  const s = nonEmptyString(10);
  assert.equal(s("").ok, false);
  assert.equal(s("   ").ok, false);
  assert.deepEqual(s("hi"), { ok: true, value: "hi" });
});

test("number coerces numeric strings and bounds/int", () => {
  assert.deepEqual(number()("42"), { ok: true, value: 42 });
  assert.equal(number({ int: true })(1.5).ok, false);
  assert.equal(number({ min: 0, max: 10 })(11).ok, false);
  assert.equal(number()("nope").ok, false);
});

test("clampedInt rounds and clamps into range, rejects non-numbers", () => {
  const s = clampedInt(0, 100);
  assert.deepEqual(s(200), { ok: true, value: 100 }); // clamp high
  assert.deepEqual(s(-50), { ok: true, value: 0 }); // clamp low
  assert.deepEqual(s(85.6), { ok: true, value: 86 }); // round
  assert.deepEqual(s("90"), { ok: true, value: 90 }); // numeric string
  assert.equal(s("nope").ok, false); // NaN rejected
  assert.equal(s(null).ok, false);
});

test("boolean only accepts booleans", () => {
  assert.deepEqual(boolean()(true), { ok: true, value: true });
  assert.equal(boolean()("true").ok, false);
});

test("oneOf restricts to the literal set", () => {
  const s = oneOf(["a", "b"] as const);
  assert.deepEqual(s("a"), { ok: true, value: "a" });
  assert.equal(s("c").ok, false);
});

test("array validates each item and enforces max", () => {
  const s = array(nonEmptyString(20), { max: 2 });
  assert.deepEqual(s(["x", "y"]), { ok: true, value: ["x", "y"] });
  assert.equal(s(["x", "y", "z"]).ok, false);
  assert.equal(s(["x", ""]).ok, false);
  assert.equal(s("not-array").ok, false);
});

test("optional maps null/undefined to undefined", () => {
  const s = optional(nonEmptyString());
  assert.deepEqual(s(undefined), { ok: true, value: undefined });
  assert.deepEqual(s(null), { ok: true, value: undefined });
  assert.deepEqual(s("v"), { ok: true, value: "v" });
});

test("object drops unknown keys and validates shape", () => {
  const s = object({ a: nonEmptyString(), b: number() });
  const res = s({ a: "x", b: 1, evil: "smuggled" });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.value, { a: "x", b: 1 });
    assert.equal("evil" in res.value, false);
  }
  assert.equal(s("nope").ok, false);
  assert.equal(s({ a: "x" }).ok, false);
});

test("idParams requires a non-empty id", () => {
  assert.deepEqual(idParams({ id: "abc" }), { ok: true, value: { id: "abc" } });
  assert.equal(idParams({ id: "" }).ok, false);
});

test("queryString / queryInt coerce + clamp", () => {
  const p = new URLSearchParams("q=hi&page=99");
  assert.equal(queryString(p, "q"), "hi");
  assert.equal(queryString(p, "missing", "fallback"), "fallback");
  assert.equal(queryInt(p, "page", { fallback: 1, min: 1, max: 10 }), 10);
  assert.equal(queryInt(p, "absent", { fallback: 3 }), 3);
});
