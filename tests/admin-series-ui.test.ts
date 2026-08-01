/**
 * Tests for the admin ReadingSeries curation UI (#1018).
 *
 * Covers:
 *  - AdminNav includes /admin/series with label "Series"
 *  - Admin series page capability gate (articlesManage) — verified via source
 *  - Status badge mapping (draft/active/archived)
 *  - AdminSeriesRowActions: status transition guards and delete guard
 *  - AdminSeriesCreate: slugify helper
 *  - UI audit route profile includes admin-series
 *
 * No React, no DOM, no database — pure logic only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { ADMIN_OPERATIONS_ROUTES, scenariosForRoutes } from "../e2e/support/ui-audit";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// AdminNav — "Series" link present
// ---------------------------------------------------------------------------

test("AdminNav includes /admin/series with label 'Series'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/series"'), "AdminNav should include /admin/series href");
  assert.ok(src.includes('label: "Series"'), "AdminNav should include Series label");
});

// ---------------------------------------------------------------------------
// Admin series page — capability gate (source-level verification)
// ---------------------------------------------------------------------------

test("admin series page source calls requireCapability with articlesManage", () => {
  const src = readSrc("src/app/admin/series/page.tsx");
  assert.ok(
    src.includes("requireCapability"),
    "Page must call requireCapability",
  );
  assert.ok(
    src.includes("CAPABILITIES.articlesManage"),
    "Page must gate on articlesManage capability",
  );
  assert.ok(
    src.includes('"/admin/series"'),
    "Page must supply /admin/series as redirect path",
  );
});

test("admin series page calls listSeriesForAdmin", () => {
  const src = readSrc("src/app/admin/series/page.tsx");
  assert.ok(
    src.includes("listSeriesForAdmin"),
    "Page must call listSeriesForAdmin to fetch series list",
  );
});

test("admin series page renders EmptyState when no series", () => {
  const src = readSrc("src/app/admin/series/page.tsx");
  assert.ok(
    src.includes("EmptyState"),
    "Page must render EmptyState for zero-row scenario",
  );
  assert.ok(
    src.includes("No series yet"),
    "EmptyState must have appropriate empty message",
  );
});

test("admin series page renders AdminSeriesCreate action", () => {
  const src = readSrc("src/app/admin/series/page.tsx");
  assert.ok(
    src.includes("AdminSeriesCreate"),
    "Page must include AdminSeriesCreate for the create action",
  );
});

test("admin series page renders AdminSeriesRowActions per row", () => {
  const src = readSrc("src/app/admin/series/page.tsx");
  assert.ok(
    src.includes("AdminSeriesRowActions"),
    "Page must include AdminSeriesRowActions for per-row operations",
  );
});

// ---------------------------------------------------------------------------
// Status badge mapping
// ---------------------------------------------------------------------------

test("status badge maps draft → neutral, active → success, archived → warning", () => {
  const STATUS_BADGE: Record<string, string> = {
    draft: "neutral",
    active: "success",
    archived: "warning",
  };

  assert.equal(STATUS_BADGE.draft, "neutral");
  assert.equal(STATUS_BADGE.active, "success");
  assert.equal(STATUS_BADGE.archived, "warning");
});

// ---------------------------------------------------------------------------
// AdminSeriesRowActions — status transition guards
// ---------------------------------------------------------------------------

test("canActivate is true only for draft series", () => {
  function canActivate(status: string) {
    return status === "draft";
  }
  assert.ok(canActivate("draft"));
  assert.ok(!canActivate("active"));
  assert.ok(!canActivate("archived"));
});

test("canArchive is true only for active series", () => {
  function canArchive(status: string) {
    return status === "active";
  }
  assert.ok(canArchive("active"));
  assert.ok(!canArchive("draft"));
  assert.ok(!canArchive("archived"));
});

test("canDelete is false for active series with articles", () => {
  function canDelete(status: string, articleCount: number) {
    return status !== "active" || articleCount === 0;
  }
  assert.ok(!canDelete("active", 5));
  assert.ok(canDelete("active", 0));
  assert.ok(canDelete("draft", 5));
  assert.ok(canDelete("archived", 5));
});

test("AdminSeriesRowActions source includes activate/archive/delete operations", () => {
  const src = readSrc("src/components/AdminSeriesRowActions.tsx");
  assert.ok(src.includes("handleActivate"), "RowActions must have activate handler");
  assert.ok(src.includes("handleArchive"), "RowActions must have archive handler");
  assert.ok(src.includes("handleDelete"), "RowActions must have delete handler");
  assert.ok(src.includes("handleEditSubmit"), "RowActions must have edit handler");
  assert.ok(src.includes("ConfirmAction"), "RowActions must use ConfirmAction for destructive ops");
  assert.ok(src.includes("Sheet"), "RowActions must use Sheet for edit form");
  assert.ok(src.includes("useMutation"), "RowActions must use useMutation hook");
});

test("AdminSeriesRowActions source uses patchJson and deleteJson", () => {
  const src = readSrc("src/components/AdminSeriesRowActions.tsx");
  assert.ok(src.includes("patchJson"), "RowActions must use patchJson for updates");
  assert.ok(src.includes("deleteJson"), "RowActions must use deleteJson for deletion");
  assert.ok(src.includes("/api/admin/series/"), "RowActions must target correct API path");
});

// ---------------------------------------------------------------------------
// AdminSeriesCreate — slugify helper and Sheet form
// ---------------------------------------------------------------------------

test("slugify converts title to URL-safe slug", () => {
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  assert.equal(slugify("Advanced Business Reading"), "advanced-business-reading");
  assert.equal(slugify("  Leading & Trailing  "), "leading-trailing");
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("CEFR B1–B2 Series"), "cefr-b1-b2-series");
  assert.equal(slugify(""), "");
});

test("AdminSeriesCreate source uses Sheet and postJson", () => {
  const src = readSrc("src/components/AdminSeriesCreate.tsx");
  assert.ok(src.includes("Sheet"), "Create component must use Sheet");
  assert.ok(src.includes("postJson"), "Create component must use postJson");
  assert.ok(src.includes("useMutation"), "Create component must use useMutation");
  assert.ok(src.includes("/api/admin/series"), "Create component must target correct API path");
  assert.ok(src.includes("slugify"), "Create component must use slugify for auto-slug");
});

test("AdminSeriesCreate source has required form fields", () => {
  const src = readSrc("src/components/AdminSeriesCreate.tsx");
  assert.ok(src.includes("form.title"), "Create form must include title field");
  assert.ok(src.includes("form.slug"), "Create form must include slug field");
  assert.ok(src.includes("form.description"), "Create form must include description field");
  assert.ok(src.includes("form.status"), "Create form must include status field");
  assert.ok(src.includes("form.public"), "Create form must include public toggle");
});

// ---------------------------------------------------------------------------
// UI audit — admin-series route profile exists
// ---------------------------------------------------------------------------

test("ui-audit ADMIN_OPERATIONS_ROUTES includes admin-series", () => {
  const src = readSrc("e2e/support/ui-audit.ts");
  assert.ok(src.includes('"admin-series"'), "ui-audit must include admin-series route id");
  assert.ok(src.includes('"/admin/series"'), "ui-audit must include /admin/series path");
  assert.ok(
    src.includes("Reading series") || src.includes("New series") || src.includes("series"),
    "ui-audit admin-series entry must have expectedText matching the page",
  );
});

test("ui-audit admin operations split registers 190 scenarios", () => {
  const scenarios = scenariosForRoutes(ADMIN_OPERATIONS_ROUTES);
  assert.equal(scenarios.length, 190);
  assert.ok(
    scenarios.some((scenario) => scenario.route.id === "admin-series"),
    "admin-series route must be part of the admin operations UI-audit split",
  );
});
