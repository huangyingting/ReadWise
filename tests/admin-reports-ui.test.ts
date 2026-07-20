/**
 * Unit tests for the content-report admin UI wiring (issue #1141).
 *
 * Two defects are fixed and covered here:
 *   1. Reachability — `AdminNav` `SECTIONS` now links `/admin/reports` ("Reports").
 *   2. Broken actions — the dead `_method`-hidden POST forms are replaced by the
 *      `AdminReportActions` client island, which issues a REAL
 *      `PATCH /api/admin/reports/{id}` with `{ status }`.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-deleted-articles-ui.test.ts and tests/today-action-delivery.test.ts
 * (no jsdom / real DOM). The behavioral half mocks `patchJson` and drives the
 * extracted `submitReportStatus` helper the island calls. Backend PATCH behavior
 * is covered by tests/admin-reports-routes.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type PatchCall = { url: string; body: unknown };
let patchCalls: PatchCall[] = [];
let patchResponse: unknown;
let reportActions: typeof import("@/lib/moderation/report-actions");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      patchJson: async (url: string, body: unknown) => {
        patchCalls.push({ url, body });
        return patchResponse;
      },
    },
  });
  reportActions = await import("@/lib/moderation/report-actions");
});

beforeEach(() => {
  patchCalls = [];
  patchResponse = { ok: true, reportId: "r1", status: "RESOLVED" };
});

// ---------------------------------------------------------------------------
// (1) Reachability — AdminNav links /admin/reports
// ---------------------------------------------------------------------------

test("AdminNav SECTIONS includes /admin/reports with label 'Reports'", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/reports"'), "nav must link /admin/reports");
  assert.ok(src.includes('label: "Reports"'), "nav entry must be labelled Reports");
});

// ---------------------------------------------------------------------------
// (2) Broken actions — submitReportStatus issues the correct PATCH
// ---------------------------------------------------------------------------

test("reportStatusEndpoint targets the admin report route", () => {
  assert.equal(reportActions.reportStatusEndpoint("abc123"), "/api/admin/reports/abc123");
});

test("submitReportStatus PATCHes /api/admin/reports/{id} with status RESOLVED", async () => {
  const res = await reportActions.submitReportStatus("rep-1", "RESOLVED");
  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0]?.url, "/api/admin/reports/rep-1");
  assert.deepEqual(patchCalls[0]?.body, { status: "RESOLVED" });
  assert.deepEqual(res, { ok: true, reportId: "r1", status: "RESOLVED" });
});

test("submitReportStatus PATCHes with status DISMISSED", async () => {
  patchResponse = { ok: true, reportId: "rep-2", status: "DISMISSED" };
  await reportActions.submitReportStatus("rep-2", "DISMISSED");
  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0]?.url, "/api/admin/reports/rep-2");
  assert.deepEqual(patchCalls[0]?.body, { status: "DISMISSED" });
});

test("submitReportStatus sends ONLY the status enum (no note/content leaked)", async () => {
  await reportActions.submitReportStatus("rep-3", "RESOLVED");
  const body = patchCalls[0]?.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["status"], "body carries only the terminal status");
});

// ---------------------------------------------------------------------------
// AdminReportActions island — composed from primitives, real PATCH, no _method
// ---------------------------------------------------------------------------

test("AdminReportActions is a client island wired to the PATCH helper via useMutation", () => {
  const src = readSrc("src/components/AdminReportActions.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("useMutation"), "uses the useMutation hook for busy/error");
  assert.ok(src.includes("submitReportStatus"), "issues the PATCH via the helper");
  assert.ok(src.includes("refreshOnSuccess"), "refreshes the server component on success");
  assert.ok(src.includes('"RESOLVED"') && src.includes('"DISMISSED"'), "offers both terminal actions");
  assert.ok(src.includes("<Button"), "composed from the Button primitive");
  assert.ok(src.includes("disabled={busy}"), "controls disable while busy");
  assert.ok(src.includes('role="alert"'), "surfaces an inline error region");
  // The dead POST/_method form pattern must be gone.
  assert.ok(!src.includes('name="_method"'), "must not resurrect the _method hidden input");
  assert.ok(!src.includes('method="POST"'), "must not POST");
});

test("AdminReportActions is token-driven (no raw hex colour, no inline font-size/style)", () => {
  const src = readSrc("src/components/AdminReportActions.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});

// ---------------------------------------------------------------------------
// reports/page.tsx — island wired in, dead forms gone, gating preserved
// ---------------------------------------------------------------------------

test("reports page renders AdminReportActions and no longer uses the dead _method forms", () => {
  const src = readSrc("src/app/admin/reports/page.tsx");
  assert.ok(src.includes("AdminReportActions"), "renders the client action island");
  assert.ok(src.includes("reportId={report.id}"), "passes the report id to the island");
  assert.ok(!src.includes("_method"), "the dead _method hidden input is removed");
  assert.ok(!src.includes('method="POST"'), "no raw POST form remains");
  // Gating + terminal fallback are unchanged.
  assert.ok(src.includes("isActionableStatus"), "keeps the actionable-status gate");
  assert.ok(src.includes("formatDateTime(report.resolvedAt)"), "keeps the terminal timestamp fallback");
});
