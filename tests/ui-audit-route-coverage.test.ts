import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_OPERATIONS_ROUTES,
  SCENARIOS,
  UI_AUDIT_ASYNC_CONTENT_TIMEOUT_MS,
} from "../e2e/support/ui-audit";

const REQUIRED_ADMIN_ROUTES = [
  ["admin-canonical-conflicts", "/admin/canonical-conflicts"],
  ["admin-deleted-articles", "/admin/deleted-articles"],
  ["admin-organizations", "/admin/organizations"],
  ["admin-organization-detail", "/admin/organizations/e2e-admin-org"],
] as const;

test("UI audit visits every admin governance surface", () => {
  for (const [id, path] of REQUIRED_ADMIN_ROUTES) {
    const route = ADMIN_OPERATIONS_ROUTES.find((candidate) => candidate.id === id);
    assert.ok(route, `missing UI audit profile ${id}`);
    assert.equal(route.path, path);
  }
});

test("UI audit registers 56 routes across every intent and presentation", () => {
  assert.equal(SCENARIOS.length, 560);
});

test("UI audit gives client-loaded route content a bounded cold-start budget", () => {
  assert.equal(UI_AUDIT_ASYNC_CONTENT_TIMEOUT_MS, 30_000);
});
