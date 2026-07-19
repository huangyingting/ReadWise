/**
 * Route tests for the dedicated historical-backfill admin API (#1101, Phase 3.2).
 *
 * Verifies the high-permission capability gate (`sources.manage`) is enforced for
 * the create/preview (POST), list (GET), detail (GET), and control (POST) routes
 * — 401 unauth, 403 missing-capability — and that a denied caller NEVER reaches
 * the lib layer. Also covers: the mandatory `reason`, bounds validation
 * (malformed/ordered dates, non-positive maxItems), the DRY-RUN path creating NO
 * run (previewBackfill only, no createBackfillRun, no audit — AC), the create
 * path auditing sanitized metadata (ids/bounds/reason/warnings — no URL/content),
 * and the control outcome→HTTP mapping (applied/noop 200, not-found 404,
 * illegal/stale 409) with the idempotent-noop-writes-NO-audit rule.
 * `@/lib/api-auth`, `@/lib/security/audit`, and the backfill lib layer are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];

let previewCalls: unknown[] = [];
let createCalls: Record<string, unknown>[] = [];
let listCalls: unknown[] = [];
let getCalls: string[] = [];
let controlCalls: { runId: string; action: string }[] = [];

let previewResult: unknown = {
  eligibleCount: 3,
  observedBaselineCount: 2,
  observedShadowCount: 1,
  knownWithArticleCount: 5,
  effectiveReactivationCount: 3,
};
let runDto: unknown = { id: "run-1", providerKey: "undark", status: "RUNNING", reason: "gap remediation" };
let controlOutcome: Record<string, unknown> = {
  ok: true,
  kind: "applied",
  action: "pause",
  fromStatus: "RUNNING",
  toStatus: "PAUSED",
};

const AUDIT_ACTIONS = {
  adminBackfillCreate: "admin.backfill.create",
  adminBackfillControl: "admin.backfill.control",
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

  mock.module("@/lib/scraper/incremental/backfill-query", {
    namedExports: {
      BACKFILL_RUN_STATUSES: ["RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"],
      previewBackfill: async (scope: unknown, bounds: unknown) => {
        previewCalls.push({ scope, bounds });
        return previewResult;
      },
      listBackfillRuns: async (filter: unknown) => {
        listCalls.push(filter);
        return { runs: [runDto], total: 1, offset: 0, limit: 50 };
      },
      getBackfillRun: async (id: string) => {
        getCalls.push(id);
        return runDto;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/backfill-commit", {
    namedExports: {
      createBackfillRun: async (input: Record<string, unknown>) => {
        createCalls.push(input);
        return { id: "run-1" };
      },
      applyBackfillControl: async (input: { runId: string; action: string }) => {
        controlCalls.push(input);
        return controlOutcome;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  previewCalls = [];
  createCalls = [];
  listCalls = [];
  getCalls = [];
  controlCalls = [];
  previewResult = {
    eligibleCount: 3,
    observedBaselineCount: 2,
    observedShadowCount: 1,
    knownWithArticleCount: 5,
    effectiveReactivationCount: 3,
  };
  runDto = { id: "run-1", providerKey: "undark", status: "RUNNING", reason: "gap remediation" };
  controlOutcome = { ok: true, kind: "applied", action: "pause", fromStatus: "RUNNING", toStatus: "PAUSED" };
});

const importCreate = async () =>
  ((await import("@/app/api/admin/backfill/route")) as { POST: RouteHandler }).POST;
const importListRoute = async () =>
  ((await import("@/app/api/admin/backfill/route")) as { GET: RouteHandler }).GET;
const importDetail = async () =>
  ((await import("@/app/api/admin/backfill/[id]/route")) as { GET: RouteHandler }).GET;
const importControl = async () =>
  ((await import("@/app/api/admin/backfill/[id]/route")) as { POST: RouteHandler }).POST;

function createReqBody(over: Record<string, unknown> = {}) {
  return { providerKey: "undark", reason: "gap remediation", maxItems: 100, ...over };
}

// ---- POST /api/admin/backfill (create + dry-run) --------------------------

test("POST create requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importCreate();
  const res = await POST(jsonPost("http://test/api/admin/backfill", createReqBody()), undefined);
  assert.equal(res.status, 401);
  assert.equal(createCalls.length, 0);
  assert.equal(previewCalls.length, 0);
});

test("POST create denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const POST = await importCreate();
  const res = await POST(jsonPost("http://test/api/admin/backfill", createReqBody()), undefined);
  assert.equal(res.status, 403);
  assert.equal(createCalls.length, 0);
});

test("POST create requires a reason (400) without running the commit", async () => {
  const POST = await importCreate();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill", { providerKey: "undark", maxItems: 100 }),
    undefined,
  );
  assert.equal(res.status, 400);
  assert.equal(createCalls.length, 0);
});

test("POST create rejects a non-positive maxItems (400)", async () => {
  const POST = await importCreate();
  const res = await POST(jsonPost("http://test/api/admin/backfill", createReqBody({ maxItems: 0 })), undefined);
  assert.equal(res.status, 400);
  assert.equal(createCalls.length, 0);
});

test("POST create rejects a malformed window date (400)", async () => {
  const POST = await importCreate();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill", createReqBody({ windowStart: "not-a-date" })),
    undefined,
  );
  assert.equal(res.status, 400);
  assert.equal(createCalls.length, 0);
});

test("POST create rejects an inverted window (start after end → 400, invalid-window-order)", async () => {
  const POST = await importCreate();
  const res = await POST(
    jsonPost(
      "http://test/api/admin/backfill",
      createReqBody({ windowStart: "2026-07-02T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" }),
    ),
    undefined,
  );
  assert.equal(res.status, 400);
  const data = await readJson<{ reason?: string }>(res);
  assert.equal(data.reason, "invalid-window-order");
  assert.equal(createCalls.length, 0);
});

test("POST dry-run returns counts, creates NO run, and writes NO audit (AC)", async () => {
  const POST = await importCreate();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill", createReqBody({ dryRun: true })),
    undefined,
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ dryRun: boolean; preview: { eligibleCount: number } }>(res);
  assert.equal(data.dryRun, true);
  assert.equal(data.preview.eligibleCount, 3);
  assert.equal(previewCalls.length, 1);
  assert.equal(createCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("POST create persists a run (201), returns the DTO, and audits sanitized metadata", async () => {
  const POST = await importCreate();
  const res = await POST(
    jsonPost(
      "http://test/api/admin/backfill",
      createReqBody({ windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-02-01T00:00:00.000Z" }),
    ),
    undefined,
  );
  assert.equal(res.status, 201);
  const data = await readJson<{ ok: boolean; dryRun: boolean; run: { id: string } }>(res);
  assert.equal(data.dryRun, false);
  assert.equal(data.run.id, "run-1");
  assert.equal(createCalls.length, 1);
  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.backfill.create");
  assert.equal(audit?.targetType, "backfill_run");
  assert.equal(audit?.targetId, "run-1");
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
  assert.match(meta, /"reason":"gap remediation"/);
});

// ---- GET /api/admin/backfill (list) --------------------------------------

test("GET list requires the capability (401 unauth, never queries)", async () => {
  authState = "unauth";
  const GET = await importListRoute();
  const res = await GET(getReq("http://test/api/admin/backfill"));
  assert.equal(res.status, 401);
  assert.equal(listCalls.length, 0);
});

test("GET list returns the page and forwards sanitized filters", async () => {
  const GET = await importListRoute();
  const res = await GET(
    getReq("http://test/api/admin/backfill?status=PAUSED&providerKey=undark&offset=5&limit=10"),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls[0], { status: "PAUSED", providerKey: "undark", offset: 5, limit: 10 });
});

test("GET list ignores an unknown status filter", async () => {
  const GET = await importListRoute();
  const res = await GET(getReq("http://test/api/admin/backfill?status=BOGUS"));
  assert.equal(res.status, 200);
  assert.equal((listCalls[0] as { status?: string }).status, undefined);
});

// ---- GET /api/admin/backfill/[id] (detail) -------------------------------

test("GET detail denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/backfill/run-1"), withParams({ id: "run-1" }));
  assert.equal(res.status, 403);
  assert.equal(getCalls.length, 0);
});

test("GET detail returns the sanitized run DTO", async () => {
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/backfill/run-1"), withParams({ id: "run-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(getCalls, ["run-1"]);
  const data = await readJson<{ run: { id: string } }>(res);
  assert.equal(data.run.id, "run-1");
});

test("GET detail returns 404 when the run is missing", async () => {
  runDto = null;
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/backfill/nope"), withParams({ id: "nope" }));
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/backfill/[id] (control) -----------------------------

test("POST control requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "pause" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(controlCalls.length, 0);
});

test("POST control rejects an unknown action (400) without running the commit", async () => {
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "explode" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(controlCalls.length, 0);
});

test("POST control applied returns 200 and audits sanitized metadata", async () => {
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "pause", reason: "throttle" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; toStatus: string }>(res);
  assert.equal(data.outcome, "applied");
  assert.equal(data.toStatus, "PAUSED");
  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.backfill.control");
  assert.equal(audit?.targetId, "run-1");
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
  assert.match(meta, /"toStatus":"PAUSED"/);
});

test("POST control noop is a 200 that writes NO audit (idempotent)", async () => {
  controlOutcome = { ok: true, kind: "noop", action: "pause", reason: "already-paused", status: "PAUSED" };
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "pause" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; reason: string }>(res);
  assert.equal(data.outcome, "noop");
  assert.equal(data.reason, "already-paused");
  assert.equal(auditCalls.length, 0);
});

test("POST control illegal transition maps to 409 with a reason and NO audit", async () => {
  controlOutcome = { ok: false, reason: "illegal", action: "resume", illegal: "not-paused", status: "RUNNING" };
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "resume" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string; detail: string }>(res);
  assert.equal(data.reason, "illegal");
  assert.equal(data.detail, "not-paused");
  assert.equal(auditCalls.length, 0);
});

test("POST control stale maps to 409 with stale:true", async () => {
  controlOutcome = { ok: false, reason: "stale", action: "pause", status: "CANCELLED" };
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/run-1", { action: "pause" }),
    withParams({ id: "run-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ stale: boolean }>(res);
  assert.equal(data.stale, true);
  assert.equal(auditCalls.length, 0);
});

test("POST control not-found maps to 404", async () => {
  controlOutcome = { ok: false, reason: "not-found", action: "pause" };
  const POST = await importControl();
  const res = await POST(
    jsonPost("http://test/api/admin/backfill/nope", { action: "pause" }),
    withParams({ id: "nope" }),
  );
  assert.equal(res.status, 404);
});
