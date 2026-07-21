import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_CONFLICT_STATUSES,
  isCanonicalConflictStatus,
} from "@/lib/scraper/incremental/canonical-conflict-status";

test("canonical conflict statuses stay ordered and client-safe", () => {
  assert.deepEqual([...CANONICAL_CONFLICT_STATUSES], ["OPEN", "RESOLVED", "DISMISSED"]);
  assert.equal(isCanonicalConflictStatus("OPEN"), true);
  assert.equal(isCanonicalConflictStatus("RESOLVED"), true);
  assert.equal(isCanonicalConflictStatus("DISMISSED"), true);
  assert.equal(isCanonicalConflictStatus("QUEUED"), false);
  assert.equal(isCanonicalConflictStatus(""), false);
});
