import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIGGER_MODE,
  IMPLEMENTED_TRIGGER_MODES,
  TRIGGER_MODES,
  validateTriggerMode,
} from "@/lib/scraper/incremental/trigger-mode";

test("incremental is the only normal trigger mode and is the default", () => {
  assert.deepEqual(TRIGGER_MODES, ["incremental", "backfill", "force-rescrape"]);
  assert.deepEqual(IMPLEMENTED_TRIGGER_MODES, ["incremental"]);
  assert.equal(DEFAULT_TRIGGER_MODE, "incremental");
  assert.deepEqual(validateTriggerMode(undefined), { ok: true, mode: "incremental" });
  assert.deepEqual(validateTriggerMode(null), { ok: true, mode: "incremental" });
  assert.deepEqual(validateTriggerMode("incremental"), { ok: true, mode: "incremental" });
});

test("unknown modes fail closed without echoing the supplied value", () => {
  for (const input of ["refresh", "https://private.example/secret", 4, {}, []]) {
    const result = validateTriggerMode(input);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.reason, "unknown-mode");
    assert.match(result.message, /Supported: incremental/);
    assert.doesNotMatch(result.message, /private\.example|refresh/);
  }
});

test("privileged modes point to their dedicated admin operations", () => {
  const backfill = validateTriggerMode("backfill");
  assert.equal(backfill.ok, false);
  if (!backfill.ok) {
    assert.equal(backfill.reason, "not-implemented");
    assert.match(backfill.message, /dedicated admin backfill endpoint/);
  }

  const rescrape = validateTriggerMode("force-rescrape");
  assert.equal(rescrape.ok, false);
  if (!rescrape.ok) {
    assert.equal(rescrape.reason, "not-implemented");
    assert.match(rescrape.message, /dedicated admin force-rescrape endpoint/);
  }
});
