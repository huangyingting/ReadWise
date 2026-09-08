import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldBlockOfflineView } from "@/lib/offline/ownership-visibility";

test("terminal offline fencing does not replace the anonymous application", () => {
  assert.equal(shouldBlockOfflineView(null, null, true), false);
});

test("authenticated stale sessions remain blocked", () => {
  assert.equal(shouldBlockOfflineView("account-a", null, true), true);
  assert.equal(
    shouldBlockOfflineView("account-a", "account-b", false),
    true,
  );
});
