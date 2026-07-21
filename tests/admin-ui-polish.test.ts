/**
 * Source-level admin UI polish tests (#1193).
 *
 * Locks in filtered-empty recovery actions, shared AdminPageHeader usage, and
 * loading-state announcements without jsdom.
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

test("admin filtered-empty pages render EmptyState with clear-filters recovery", () => {
  for (const rel of [
    "src/app/admin/articles/page.tsx",
    "src/app/admin/tags/page.tsx",
    "src/app/admin/jobs/page.tsx",
  ]) {
    const src = readSrc(rel);
    assert.ok(src.includes("EmptyState"), `${rel} uses the shared EmptyState primitive`);
    assert.ok(src.includes("hasActiveFilters"), `${rel} distinguishes filtered-empty from truly empty`);
    assert.ok(src.includes("Clear filters"), `${rel} offers a clear-filters action`);
    assert.ok(src.includes("AdminResultCount"), `${rel} preserves the live result-count text`);
  }
});

test("AdminPageHeader supports actions/subtitle and replaces bespoke admin h1 wrappers", () => {
  const header = readSrc("src/components/admin/AdminPageHeader.tsx");
  assert.ok(header.includes("actions?: React.ReactNode"), "AdminPageHeader has an actions slot");
  assert.ok(header.includes("subtitle?: React.ReactNode"), "AdminPageHeader has a subtitle slot");
  assert.ok(header.includes("justify-between"), "actions use the shared heading row layout");

  for (const rel of [
    "src/app/admin/analytics/page.tsx",
    "src/app/admin/analytics/ai/page.tsx",
    "src/app/admin/security/page.tsx",
    "src/app/admin/members/[id]/page.tsx",
    "src/app/admin/articles/[id]/page.tsx",
  ]) {
    const src = readSrc(rel);
    assert.ok(src.includes("AdminPageHeader"), `${rel} uses AdminPageHeader`);
    assert.ok(!src.includes("<h1"), `${rel} no longer hand-rolls an h1`);
    assert.ok(
      !src.includes("text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold"),
      `${rel} no longer duplicates the admin h1 class`,
    );
  }
});

test("route loading shells announce loading while keeping skeleton visuals hidden", () => {
  const adminLoading = readSrc("src/app/admin/loading.tsx");
  assert.ok(adminLoading.includes('aria-busy="true"'), "admin loading marks the region busy");
  assert.ok(adminLoading.includes('role="status"'), "admin loading announces status");
  assert.ok(adminLoading.includes("Loading admin page"), "admin loading has status copy");
  assert.ok(adminLoading.includes("<div aria-hidden>"), "admin skeleton visuals stay hidden");
  assert.ok(!adminLoading.includes("<div aria-hidden style"), "status is not hidden by the visual wrapper");

  const listingShell = readSrc("src/components/route-states/ListingLoadingShell.tsx");
  assert.ok(listingShell.includes("loadingLabel"), "shared listing shell accepts status copy");
  assert.ok(listingShell.includes('aria-busy="true"'), "listing shell marks the region busy");
  assert.ok(listingShell.includes('role="status"'), "listing shell announces status");
  assert.ok(listingShell.includes("<div aria-hidden>"), "listing skeleton visuals stay hidden");
  assert.ok(
    !listingShell.includes('className="listing-container" aria-hidden'),
    "listing shell no longer hides the whole loading region from assistive tech",
  );
});
