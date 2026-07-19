/**
 * Route tests for the dedicated force-rescrape admin API (#1102, Phase 3.3).
 *
 * Verifies the high-permission capability gate (`sources.manage`) is enforced for
 * the request/preview (POST) and status (GET) routes — 401 unauth, 403 missing
 * capability — and that a denied caller NEVER reaches the runner (AC3: the only
 * force-rescrape entry point is capability-gated). Also covers: the mandatory
 * `reason`; the `SCRAPER_FORCE_RESCRAPE=false` kill-switch (503, no runner call);
 * the DRY-RUN path (no audit); the activated + controlled-failure paths writing
 * sanitized audit metadata (reason category, version ids, failure code — never a
 * URL/content); the concurrent-conflict 409 (no audit); and the ineligible→HTTP
 * mapping. `@/lib/api-auth`, `@/lib/security/audit`, and the force-rescrape lib
 * layer are mocked; the kill-switch is driven by the real config via env.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];
let requestCalls: Record<string, unknown>[] = [];
let statusCalls: string[] = [];

let rescrapeOutcome: Record<string, unknown> = {
  ok: true,
  kind: "activated",
  articleId: "art-1",
  versionId: "ver-2",
  supersededVersionId: "ver-1",
};
let statusResult: unknown = {
  articleId: "art-1",
  activeVersion: { id: "ver-1", status: "ACTIVE", isActive: true, isPending: false },
  pendingVersion: null,
  annotationCount: 0,
  versions: [],
};

const AUDIT_ACTIONS = {
  adminForceRescrapeActivate: "admin.force_rescrape.activate",
  adminForceRescrapeFail: "admin.force_rescrape.fail",
  securityAdminAccessDenied: "security.admin_access_denied",
};

before(() => {
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS,
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: AuditCall) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: AuditCall) => {
        auditCalls.push(input);
      },
    },
  });

  mock.module("@/lib/scraper/incremental/force-rescrape-runner", {
    namedExports: {
      requestForceRescrape: async (input: Record<string, unknown>) => {
        requestCalls.push(input);
        return rescrapeOutcome;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/force-rescrape-query", {
    namedExports: {
      getForceRescrapeStatus: async (id: string) => {
        statusCalls.push(id);
        return statusResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  requestCalls = [];
  statusCalls = [];
  delete process.env.SCRAPER_FORCE_RESCRAPE;
  rescrapeOutcome = {
    ok: true,
    kind: "activated",
    articleId: "art-1",
    versionId: "ver-2",
    supersededVersionId: "ver-1",
  };
  statusResult = {
    articleId: "art-1",
    activeVersion: { id: "ver-1", status: "ACTIVE", isActive: true, isPending: false },
    pendingVersion: null,
    annotationCount: 0,
    versions: [],
  };
});

const importPost = async () =>
  ((await import("@/app/api/admin/articles/[id]/force-rescrape/route")) as { POST: RouteHandler }).POST;
const importGet = async () =>
  ((await import("@/app/api/admin/articles/[id]/force-rescrape/route")) as { GET: RouteHandler }).GET;

const postUrl = "http://test/api/admin/articles/art-1/force-rescrape";
const params = withParams({ id: "art-1" });

// ---- POST auth gating (AC3: only the gated endpoint reaches the runner) ----

test("POST requires the capability (401 unauth) and never runs the rescrape", async () => {
  authState = "unauth";
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "legal correction" }), params);
  assert.equal(res.status, 401);
  assert.equal(requestCalls.length, 0);
});

test("POST denies a caller missing the capability (403) and never runs the rescrape", async () => {
  authState = "forbidden";
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "legal correction" }), params);
  assert.equal(res.status, 403);
  assert.equal(requestCalls.length, 0);
});

test("POST requires a reason (400) without running the rescrape", async () => {
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, {}), params);
  assert.equal(res.status, 400);
  assert.equal(requestCalls.length, 0);
});

// ---- kill-switch ----------------------------------------------------------

test("POST is hard-disabled by SCRAPER_FORCE_RESCRAPE=false (503, no runner call)", async () => {
  process.env.SCRAPER_FORCE_RESCRAPE = "false";
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "legal correction" }), params);
  assert.equal(res.status, 503);
  const data = await readJson<{ reason?: string }>(res);
  assert.equal(data.reason, "disabled");
  assert.equal(requestCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- dry-run --------------------------------------------------------------

test("POST dry-run returns a preview and writes NO audit", async () => {
  rescrapeOutcome = {
    ok: true,
    kind: "dry-run",
    preview: { articleId: "art-1", annotationCount: 2, migratorWired: false, wouldActivate: false },
  };
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "preview", dryRun: true }), params);
  assert.equal(res.status, 200);
  const data = await readJson<{ dryRun: boolean; preview: { annotationCount: number } }>(res);
  assert.equal(data.dryRun, true);
  assert.equal(data.preview.annotationCount, 2);
  assert.equal(requestCalls.length, 1);
  assert.equal((requestCalls[0] as { dryRun?: boolean }).dryRun, true);
  assert.equal(auditCalls.length, 0);
});

// ---- activated (AC2: records who + reason) ---------------------------------

test("POST activated returns the same article id and audits sanitized metadata", async () => {
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "publisher correction" }), params);
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; articleId: string; versionId: string }>(res);
  assert.equal(data.outcome, "activated");
  assert.equal(data.articleId, "art-1");
  assert.equal(data.versionId, "ver-2");

  assert.equal(auditCalls.length, 1);
  const audit = auditCalls[0];
  assert.equal(audit.action, "admin.force_rescrape.activate");
  assert.equal(audit.targetType, "article");
  assert.equal(audit.targetId, "art-1");
  assert.equal(audit.metadata?.reason, "publisher correction");
  assert.equal(audit.metadata?.versionId, "ver-2");
  // Never leaks content/URLs — only ids, the reason category, and version ids.
  assert.equal(audit.metadata?.content, undefined);
  assert.equal(audit.metadata?.sourceUrl, undefined);
});

// ---- controlled failure (AC1: old version retained; audited) ---------------

test("POST controlled failure returns outcome=failed and audits the failure code", async () => {
  rescrapeOutcome = {
    ok: true,
    kind: "failed",
    articleId: "art-1",
    versionId: "ver-2",
    reason: "annotation_migration_required",
  };
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "refresh" }), params);
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; reason: string }>(res);
  assert.equal(data.outcome, "failed");
  assert.equal(data.reason, "annotation_migration_required");

  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.force_rescrape.fail");
  assert.equal(auditCalls[0].metadata?.failureReason, "annotation_migration_required");
});

// ---- concurrent conflict (AC4 at the API surface) --------------------------

test("POST concurrent conflict returns 409 and writes NO audit", async () => {
  rescrapeOutcome = { ok: false, kind: "conflict" };
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "refresh" }), params);
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string; concurrent: boolean }>(res);
  assert.equal(data.reason, "conflict");
  assert.equal(data.concurrent, true);
  assert.equal(auditCalls.length, 0);
});

// ---- ineligible → HTTP mapping --------------------------------------------

test("POST not-found target returns 404 (no audit)", async () => {
  rescrapeOutcome = { ok: false, kind: "not-eligible", reason: "not-found" };
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "refresh" }), params);
  assert.equal(res.status, 404);
  assert.equal(auditCalls.length, 0);
});

test("POST an ineligible (non-public) target returns 409 (no audit)", async () => {
  rescrapeOutcome = { ok: false, kind: "not-eligible", reason: "not-public" };
  const POST = await importPost();
  const res = await POST(jsonPost(postUrl, { reason: "refresh" }), params);
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string }>(res);
  assert.equal(data.reason, "not-public");
  assert.equal(auditCalls.length, 0);
});

// ---- GET status -----------------------------------------------------------

test("GET status requires the capability (401 unauth)", async () => {
  authState = "unauth";
  const GET = await importGet();
  const res = await GET(getReq(postUrl), params);
  assert.equal(res.status, 401);
  assert.equal(statusCalls.length, 0);
});

test("GET status returns the sanitized status DTO", async () => {
  const GET = await importGet();
  const res = await GET(getReq(postUrl), params);
  assert.equal(res.status, 200);
  const data = await readJson<{ status: { articleId: string } }>(res);
  assert.equal(data.status.articleId, "art-1");
  assert.equal(statusCalls.length, 1);
});

test("GET status returns 404 when the article does not exist", async () => {
  statusResult = null;
  const GET = await importGet();
  const res = await GET(getReq(postUrl), params);
  assert.equal(res.status, 404);
});
