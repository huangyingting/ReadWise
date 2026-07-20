/**
 * Unit tests for the operator force-rescrape admin UI wiring (issue #1142).
 *
 * The heavyweight force-rescrape backend (#1102/#1103/#1129) exists and is
 * fully tested at `POST /api/admin/articles/{id}/force-rescrape`
 * (tests/admin-force-rescrape-routes.test.ts); it was simply
 * unreachable from the admin UI. This surfaces it via the
 * `AdminForceRescrapePanel` client island on the article DETAIL page, gated on
 * `sources.manage` AND the `SCRAPER_FORCE_RESCRAPE` kill-switch. Backend POST
 * behaviour stays covered by tests/admin-force-rescrape-routes.test.ts.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-reports-ui.test.ts (no jsdom / real DOM). The behavioral half
 * mocks `postJson` and drives the extracted `submitForceRescrape` helper the
 * island calls.
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

type PostCall = { url: string; body: unknown };
let postCalls: PostCall[] = [];
let postResponse: unknown;
let forceRescrapeActions: typeof import("@/lib/admin/articles/force-rescrape-actions");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      postJson: async (url: string, body: unknown) => {
        postCalls.push({ url, body });
        return postResponse;
      },
    },
  });
  forceRescrapeActions = await import("@/lib/admin/articles/force-rescrape-actions");
});

beforeEach(() => {
  postCalls = [];
  postResponse = { ok: true, dryRun: true, preview: { articleId: "a1", annotationCount: 0, migratorWired: true, wouldActivate: true } };
});

// ---------------------------------------------------------------------------
// Helper — submitForceRescrape targets the right route with the right body
// ---------------------------------------------------------------------------

test("forceRescrapeEndpoint targets the admin force-rescrape route", () => {
  assert.equal(
    forceRescrapeActions.forceRescrapeEndpoint("abc123"),
    "/api/admin/articles/abc123/force-rescrape",
  );
});

test("submitForceRescrape POSTs a dry-run with { reason, dryRun:true }", async () => {
  await forceRescrapeActions.submitForceRescrape("art-1", "stale extraction", true);
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0]?.url, "/api/admin/articles/art-1/force-rescrape");
  assert.deepEqual(postCalls[0]?.body, { reason: "stale extraction", dryRun: true });
});

test("submitForceRescrape POSTs a real run with { reason, dryRun:false }", async () => {
  postResponse = { ok: true, dryRun: false, outcome: "activated", articleId: "art-2", versionId: "v9", supersededVersionId: "v8" };
  const res = await forceRescrapeActions.submitForceRescrape("art-2", "operator refresh", false);
  assert.equal(postCalls[0]?.url, "/api/admin/articles/art-2/force-rescrape");
  assert.deepEqual(postCalls[0]?.body, { reason: "operator refresh", dryRun: false });
  assert.deepEqual(res, postResponse);
});

test("submitForceRescrape body carries ONLY { reason, dryRun } (no URL/content leaked)", async () => {
  await forceRescrapeActions.submitForceRescrape("art-3", "why", true);
  const body = postCalls[0]?.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["dryRun", "reason"], "body ⊆ { reason, dryRun }");
});

// ---------------------------------------------------------------------------
// AdminForceRescrapePanel island — primitives, required reason, confirm, refresh
// ---------------------------------------------------------------------------

test("AdminForceRescrapePanel is a client island wired to the helper via useMutation", () => {
  const src = readSrc("src/components/AdminForceRescrapePanel.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("useMutation"), "uses the useMutation hook for busy/error");
  assert.ok(src.includes("submitForceRescrape"), "issues the POST via the extracted helper");
  assert.ok(src.includes("<Input"), "composed from the Input primitive");
  assert.ok(src.includes("<Button"), "composed from the Button primitive");
  assert.ok(src.includes("ConfirmAction"), "the real run is gated behind a confirm");
  assert.ok(src.includes("submit(true)") && src.includes("submit(false)"), "offers dry-run and real actions");
  assert.ok(src.includes("router.refresh()"), "refreshes the detail page after a real activation");
  assert.ok(src.includes('role="alert"'), "surfaces an inline error region");
});

test("AdminForceRescrapePanel enforces a required reason and disables while busy", () => {
  const src = readSrc("src/components/AdminForceRescrapePanel.tsx");
  assert.ok(src.includes("!reason.trim()"), "gates submit on a non-empty reason");
  assert.ok(src.includes("submitDisabled"), "wires the required-reason gate into the controls");
  assert.ok(src.includes("maxLength"), "bounds the reason input length");
  assert.ok(src.includes("loading={busy}"), "shows busy state on the trigger");
});

test("AdminForceRescrapePanel is token-driven (no raw hex colour, no inline font-size/style)", () => {
  // Strip `#1102`-style issue references first (their digits are valid hex).
  const src = readSrc("src/components/AdminForceRescrapePanel.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});

// ---------------------------------------------------------------------------
// articles/[id]/page.tsx — panel gated on capability AND kill-switch
// ---------------------------------------------------------------------------

test("article detail page gates the panel on sources.manage AND the kill-switch", () => {
  const src = readSrc("src/app/admin/articles/[id]/page.tsx");
  assert.ok(
    src.includes("hasCapability(session.user, CAPABILITIES.sourcesManage)"),
    "computes canForceRescrape from sources.manage",
  );
  assert.ok(src.includes("scraperForceRescrapeEnabled()"), "reads the SCRAPER_FORCE_RESCRAPE kill-switch");
  assert.ok(
    src.includes("canForceRescrape && forceRescrapeEnabled"),
    "renders the panel only when both the capability and kill-switch allow it",
  );
  assert.ok(src.includes("AdminForceRescrapePanel"), "renders the force-rescrape island");
});
