/**
 * Route tests for the deleted-article recovery admin API (#1104, Phase 3.5).
 *
 * Verifies the capability gate (`sources.manage`) is enforced for the read
 * (list) and the destructive recover routes — 401 unauth, 403 missing-capability
 * — and that a denied caller NEVER reaches the lib layer. Also covers filter
 * pass-through, the reason+confirm destructive guards, the outcome→HTTP mapping
 * (recovered 200, not-found 404, ineligible/conflict 409), the
 * recovery-writes-audit rule, and that audit metadata is sanitized
 * (ids/version/reason category — no URL/content). A source check proves the
 * correct capability is wired. `@/lib/api-auth`, `@/lib/security/audit`, and the
 * lib layer are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];

let listCalls: unknown[] = [];
let recoverCalls: string[] = [];

let listResult: unknown = { candidates: [{ id: "cand-1", providerKey: "undark" }], total: 1, offset: 0, limit: 50 };
let recoverResult: Record<string, unknown> = {
  ok: true,
  kind: "recovered",
  candidateId: "cand-1",
  jobId: "job-1",
  dedupeKey: "article-ingest:candidate:cand-1:v4",
  processingVersion: 4,
};

const AUDIT_ACTIONS = {
  adminArticleRecover: "admin.article.recover",
  adminCanonicalConflictResolve: "admin.canonical_conflict.resolve",
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

  mock.module("@/lib/scraper/incremental/deleted-article-recovery", {
    namedExports: {
      listDeletedCandidates: async (filter: unknown) => {
        listCalls.push(filter);
        return listResult;
      },
      recoverDeletedCandidate: async (candidateId: string) => {
        recoverCalls.push(candidateId);
        return recoverResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = [];
  recoverCalls = [];
  listResult = { candidates: [{ id: "cand-1", providerKey: "undark" }], total: 1, offset: 0, limit: 50 };
  recoverResult = {
    ok: true,
    kind: "recovered",
    candidateId: "cand-1",
    jobId: "job-1",
    dedupeKey: "article-ingest:candidate:cand-1:v4",
    processingVersion: 4,
  };
});

const importList = async () =>
  ((await import("@/app/api/admin/deleted-articles/route")) as { GET: RouteHandler }).GET;
const importRecover = async () =>
  ((await import("@/app/api/admin/deleted-articles/[id]/recover/route")) as { POST: RouteHandler }).POST;

const recoverSource = readFileSync(
  new URL("../src/app/api/admin/deleted-articles/[id]/recover/route.ts", import.meta.url),
  "utf8",
);

// ---- GET /api/admin/deleted-articles (list) ------------------------------

test("GET list requires the capability (401 unauth, never queries)", async () => {
  authState = "unauth";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/deleted-articles"));
  assert.equal(res.status, 401);
  assert.equal(listCalls.length, 0);
});

test("GET list denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/deleted-articles"));
  assert.equal(res.status, 403);
  assert.equal(listCalls.length, 0);
});

test("GET list returns the page and forwards sanitized filters", async () => {
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/deleted-articles?providerKey=undark&offset=5&limit=20"));
  assert.equal(res.status, 200);
  const data = await readJson<{ total: number }>(res);
  assert.equal(data.total, 1);
  assert.deepEqual(listCalls[0], { providerKey: "undark", offset: 5, limit: 20 });
});

// ---- POST /api/admin/deleted-articles/[id]/recover -----------------------

test("recover route is gated on the sources.manage capability (source check)", () => {
  assert.match(recoverSource, /CAPABILITIES\.sourcesManage/);
  assert.match(recoverSource, /adminArticleRecover/);
});

test("POST recover requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(recoverCalls.length, 0);
});

test("POST recover denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(recoverCalls.length, 0);
});

test("POST recover requires a reason (400) without running the commit", async () => {
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(recoverCalls.length, 0);
});

test("POST recover requires explicit confirmation (400) without running the commit", async () => {
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: false }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(recoverCalls.length, 0);
});

test("POST recover succeeds, returns 200, and audits sanitized metadata (no URL/content)", async () => {
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "re-admit after correction", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; candidateId: string; jobId: string; processingVersion: number }>(res);
  assert.equal(data.outcome, "recovered");
  assert.equal(data.candidateId, "cand-1");
  assert.equal(data.jobId, "job-1");
  assert.equal(data.processingVersion, 4);
  assert.deepEqual(recoverCalls, ["cand-1"]);

  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.article.recover");
  assert.equal(audit?.targetType, "crawl_candidate");
  assert.equal(audit?.targetId, "cand-1");
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
  assert.match(meta, /"processingVersion":4/);
});

test("POST recover not-found maps to 404 (no audit)", async () => {
  recoverResult = { ok: false, reason: "not-found", candidateId: "cand-1" };
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 404);
  assert.equal(auditCalls.length, 0);
});

test("POST recover ineligible (live candidate) maps to 409 (no audit)", async () => {
  recoverResult = { ok: false, reason: "ineligible", candidateId: "cand-1", status: "INGESTED" };
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string }>(res);
  assert.equal(data.reason, "ineligible");
  assert.equal(auditCalls.length, 0);
});

test("POST recover concurrent conflict maps to 409 with stale:true (no audit)", async () => {
  recoverResult = { ok: false, reason: "conflict", candidateId: "cand-1" };
  const POST = await importRecover();
  const res = await POST(
    jsonPost("http://test/api/admin/deleted-articles/cand-1/recover", { reason: "r", confirm: true }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ stale: boolean }>(res);
  assert.equal(data.stale, true);
  assert.equal(auditCalls.length, 0);
});
