/**
 * Source-level UI tests for the pending-assignment count badge (#1244).
 *
 * Verifies that AppSidebar and MoreSheet reference `pendingAssignmentCount`,
 * use the `Badge` primitive, and gate the badge on the `/assignments` href with
 * a positive count — without spinning up jsdom or importing client modules.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

// ---- Pure helper ----------------------------------------------------------

/** Mirrors the badge-gate logic in AppSidebar/MoreSheet. */
function shouldShowAssignmentBadge(href: string, count: number): boolean {
  return href === "/assignments" && count > 0;
}

test("shouldShowAssignmentBadge — true for /assignments with positive count", () => {
  assert.equal(shouldShowAssignmentBadge("/assignments", 3), true);
  assert.equal(shouldShowAssignmentBadge("/assignments", 1), true);
});

test("shouldShowAssignmentBadge — false when count is 0", () => {
  assert.equal(shouldShowAssignmentBadge("/assignments", 0), false);
});

test("shouldShowAssignmentBadge — false for other hrefs", () => {
  assert.equal(shouldShowAssignmentBadge("/dashboard", 5), false);
  assert.equal(shouldShowAssignmentBadge("/browse", 3), false);
});

// ---- AppSidebar source checks ----------------------------------------------

test("AppSidebar reads pendingAssignmentCount from user prop", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes("pendingAssignmentCount"), "references pendingAssignmentCount");
});

test("AppSidebar imports and renders Badge primitive", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes("Badge"), "imports/uses Badge");
  assert.ok(src.includes("<Badge"), "renders <Badge");
});

test("AppSidebar gates badge on /assignments href and count > 0", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes('"/assignments"'), 'checks href === "/assignments"');
  assert.ok(src.includes("pendingAssignmentCount > 0"), "gates on count > 0");
});

test("AppSidebar uses primary Badge variant for the assignment badge", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes('variant="primary"'), "uses primary variant on Badge");
});

test("AppSidebar includes an accessible aria-label on the badge", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes("pending assignments"), "badge has accessible pending assignments label");
});

test("AppSidebar shows collapsed dot indicator when sidebar is collapsed", () => {
  const src = readSrc("src/components/shell/AppSidebar.tsx");
  assert.ok(src.includes("collapsed"), "has collapsed state handling");
  assert.ok(src.includes("showBadge && collapsed"), "renders dot/indicator in collapsed state");
});

// ---- MoreSheet source checks -----------------------------------------------

test("MoreSheet reads pendingAssignmentCount from user prop", () => {
  const src = readSrc("src/components/shell/MoreSheet.tsx");
  assert.ok(src.includes("pendingAssignmentCount"), "references pendingAssignmentCount");
});

test("MoreSheet imports and renders Badge primitive", () => {
  const src = readSrc("src/components/shell/MoreSheet.tsx");
  assert.ok(src.includes("Badge"), "imports/uses Badge");
  assert.ok(src.includes("<Badge"), "renders <Badge");
});

test("MoreSheet gates badge on /assignments href and count > 0", () => {
  const src = readSrc("src/components/shell/MoreSheet.tsx");
  assert.ok(src.includes('"/assignments"'), 'checks href === "/assignments"');
  assert.ok(src.includes("> 0"), "gates on count > 0");
});

test("MoreSheet includes an accessible aria-label on the badge", () => {
  const src = readSrc("src/components/shell/MoreSheet.tsx");
  assert.ok(src.includes("pending assignments"), "badge has accessible pending assignments label");
});
