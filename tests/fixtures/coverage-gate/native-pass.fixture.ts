import { test } from "node:test";
import assert from "node:assert/strict";

test("native coverage fixture passes", () => {
  assert.equal(2 + 2, 4);
});
