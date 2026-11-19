import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoundedInt, parsePageParam } from "@/lib/search-params";

test("parseBoundedInt clamps numeric params and falls back for missing or non-numeric", () => {
  assert.equal(parseBoundedInt("25", 50, 1, 200), 25);
  assert.equal(parseBoundedInt("0", 50, 1, 200), 1);
  assert.equal(parseBoundedInt("999", 50, 1, 200), 200);
  assert.equal(parseBoundedInt(undefined, 50, 1, 200), 50);
  assert.equal(parseBoundedInt("abc", 50, 1, 200), 50);
  assert.equal(parseBoundedInt("12px", 50, 1, 200), 12);
  assert.equal(parseBoundedInt(null, 0, 1, 10), 1, "an out-of-range fallback is clamped too");
});

test("parsePageParam defaults to page 1 and never goes below it", () => {
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam(""), 1);
  assert.equal(parsePageParam("3"), 3);
  assert.equal(parsePageParam("0"), 1);
  assert.equal(parsePageParam("-4"), 1);
  assert.equal(parsePageParam("next"), 1);
});
