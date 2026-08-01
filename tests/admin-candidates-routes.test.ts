/**
 * Route tests for the candidate-review admin API (#1100, Phase 3.1).
 *
 * Verifies the capability gate (`sources.manage`) is enforced for BOTH the read
 * (list/detail) and mutation (individual + batch review) routes — 401 unauth,
 * 403 missing-capability — and that a denied caller NEVER reaches the lib layer.
 * Also covers filter pass-through, the reason-required guard, the outcome→HTTP
 * mapping (applied/noop 200, not-found 404, illegal/stale 409+`stale`), the
 * idempotent-noop-writes-NO-audit rule, the partial-batch result shape, and that
 * audit metadata is sanitized (ids/status/reason category — no URL/content).
 * `@/lib/api-auth`, `@/lib/security/audit`, and the lib layer are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };
type ReviewInput = { candidateId: string; action: string };

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];

let listCalls: unknown[] = [];
let detailCalls: string[] = [];
let reviewCalls: ReviewInput[] = [];

let listResult: unknown = { candidates: [{ id: "cand-1", status: "NEEDS_REVIEW" }], total: 1, offset: 0, limit: 50 };
let detailResult: unknown = { id: "cand-1", status: "NEEDS_REVIEW", conflicts: [] };

/** Per-candidate outcome map; falls back to an applied approve. */
let outcomeById: Record<string, Record<string, unknown>> = {};

function applied(action: string, candidateId: string, over: Record<string, unknown> = {}) {
  return {
    ok: true,
    kind: "applied",
    action,
    candidateId,
    fromStatus: "NEEDS_REVIEW",
    toStatus: action === "reject" ? "SKIPPED_REVIEW" : action === "reactivate" ? "NEEDS_REVIEW" : "QUEUED",
    enqueued: action === "approve",
    ...over,
  };
}

const AUDIT_ACTIONS = {
  adminCandidateReview: "admin.candidate.review",
  adminCandidateReactivate: "admin.candidate.reactivate",
  adminSourceTrustPromotion: "admin.source.trust_promotion",
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

  mock.module("@/lib/scraper/incremental/candidate-review-query", {
    namedExports: {
      REVIEW_QUEUE_STATUSES: ["NEEDS_REVIEW", "SKIPPED_REVIEW"],
      listReviewCandidates: async (filter: unknown) => {
        listCalls.push(filter);
        return listResult;
      },
      getReviewCandidate: async (id: string) => {
        detailCalls.push(id);
        return detailResult;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/candidate-review-commit", {
    namedExports: {
      applyCandidateReview: async (input: ReviewInput) => {
        reviewCalls.push(input);
        return outcomeById[input.candidateId] ?? applied(input.action, input.candidateId);
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = [];
  detailCalls = [];
  reviewCalls = [];
  listResult = { candidates: [{ id: "cand-1", status: "NEEDS_REVIEW" }], total: 1, offset: 0, limit: 50 };
  detailResult = { id: "cand-1", status: "NEEDS_REVIEW", conflicts: [] };
  outcomeById = {};
});

const importList = async () =>
  ((await import("@/app/api/admin/candidates/route")) as { GET: RouteHandler }).GET;
const importDetail = async () =>
  ((await import("@/app/api/admin/candidates/[id]/route")) as { GET: RouteHandler }).GET;
const importReview = async () =>
  ((await import("@/app/api/admin/candidates/[id]/review/route")) as { POST: RouteHandler }).POST;
const importBatch = async () =>
  ((await import("@/app/api/admin/candidates/review/route")) as { POST: RouteHandler }).POST;

// ---- GET /api/admin/candidates (list) ------------------------------------

test("GET list requires the capability (401 unauth, never queries)", async () => {
  authState = "unauth";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/candidates"));
  assert.equal(res.status, 401);
  assert.equal(listCalls.length, 0);
});

test("GET list denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/candidates"));
  assert.equal(res.status, 403);
  assert.equal(listCalls.length, 0);
});

test("GET list returns the page and forwards sanitized filters", async () => {
  const GET = await importList();
  const res = await GET(
    getReq("http://test/api/admin/candidates?status=SKIPPED_REVIEW&providerKey=undark&discoverySourceId=src-1&offset=10&limit=25"),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ candidates: unknown[]; total: number }>(res);
  assert.equal(data.total, 1);
  assert.deepEqual(listCalls[0], {
    status: "SKIPPED_REVIEW",
    providerKey: "undark",
    discoverySourceId: "src-1",
    offset: 10,
    limit: 25,
  });
});

test("GET list ignores an unknown status filter (defaults to NEEDS_REVIEW queue)", async () => {
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/candidates?status=BOGUS"));
  assert.equal(res.status, 200);
  assert.equal((listCalls[0] as { status?: string }).status, undefined);
});

// ---- GET /api/admin/candidates/[id] (detail) -----------------------------

test("GET detail denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/candidates/cand-1"), withParams({ id: "cand-1" }));
  assert.equal(res.status, 403);
  assert.equal(detailCalls.length, 0);
});

test("GET detail returns the sanitized candidate DTO", async () => {
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/candidates/cand-1"), withParams({ id: "cand-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(detailCalls, ["cand-1"]);
  const data = await readJson<{ candidate: { id: string } }>(res);
  assert.equal(data.candidate.id, "cand-1");
});

test("GET detail returns 404 when the candidate is missing", async () => {
  detailResult = null;
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/candidates/nope"), withParams({ id: "nope" }));
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/candidates/[id]/review (individual) ------------------

test("POST review requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(reviewCalls.length, 0);
});

test("POST review denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(reviewCalls.length, 0);
});

test("POST review rejects an unknown action (400) without running the commit", async () => {
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "explode" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(reviewCalls.length, 0);
});

test("POST review requires a reason to reject (400) without running the commit", async () => {
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "reject" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(reviewCalls.length, 0);
});

test("POST review approve applies, returns 200, and audits sanitized metadata", async () => {
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ ok: boolean; outcome: string; toStatus: string; enqueued: boolean }>(res);
  assert.equal(data.outcome, "applied");
  assert.equal(data.toStatus, "QUEUED");
  assert.equal(data.enqueued, true);
  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.candidate.review");
  assert.equal(audit?.targetId, "cand-1");
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
  assert.match(meta, /"toStatus":"QUEUED"/);
});

test("POST review reactivate uses the dedicated reactivate audit action", async () => {
  outcomeById["cand-1"] = applied("reactivate", "cand-1");
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "reactivate", reason: "operator retriage" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 200);
  assert.equal(auditCalls.at(-1)?.action, "admin.candidate.reactivate");
});

test("POST review noop is a 200 that writes NO audit (idempotent)", async () => {
  outcomeById["cand-1"] = { ok: true, kind: "noop", action: "approve", candidateId: "cand-1", reason: "already-approved", status: "QUEUED" };
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; reason: string }>(res);
  assert.equal(data.outcome, "noop");
  assert.equal(data.reason, "already-approved");
  assert.equal(auditCalls.length, 0);
});

test("POST review illegal transition maps to 409 with a reason and NO audit", async () => {
  outcomeById["cand-1"] = { ok: false, reason: "illegal", action: "approve", candidateId: "cand-1", illegal: "has-article", status: "INGESTED" };
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string; detail: string }>(res);
  assert.equal(data.reason, "illegal");
  assert.equal(data.detail, "has-article");
  assert.equal(auditCalls.length, 0);
});

test("POST review stale maps to 409 with stale:true (the stale-candidate UI state)", async () => {
  outcomeById["cand-1"] = { ok: false, reason: "stale", action: "approve", candidateId: "cand-1", status: "NEEDS_REVIEW" };
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ stale: boolean }>(res);
  assert.equal(data.stale, true);
  assert.equal(auditCalls.length, 0);
});

test("POST review not-found maps to 404", async () => {
  outcomeById["cand-1"] = { ok: false, reason: "not-found", action: "approve", candidateId: "cand-1" };
  const POST = await importReview();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/cand-1/review", { action: "approve" }),
    withParams({ id: "cand-1" }),
  );
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/candidates/review (batch) ---------------------------

test("POST batch requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importBatch();
  const res = await POST(jsonPost("http://test/api/admin/candidates/review", { action: "approve", ids: ["a", "b"] }), undefined);
  assert.equal(res.status, 401);
  assert.equal(reviewCalls.length, 0);
});

test("POST batch requires a reason to reject (400)", async () => {
  const POST = await importBatch();
  const res = await POST(jsonPost("http://test/api/admin/candidates/review", { action: "reject", ids: ["a"] }), undefined);
  assert.equal(res.status, 400);
  assert.equal(reviewCalls.length, 0);
});

test("POST batch rejects an empty id list (400)", async () => {
  const POST = await importBatch();
  const res = await POST(jsonPost("http://test/api/admin/candidates/review", { action: "approve", ids: [] }), undefined);
  assert.equal(res.status, 400);
});

test("POST batch de-duplicates ids so a candidate is acted on at most once", async () => {
  const POST = await importBatch();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/review", { action: "approve", ids: ["a", "a", "a"] }),
    undefined,
  );
  assert.equal(res.status, 200);
  assert.equal(reviewCalls.length, 1);
});

test("POST batch returns a partial-batch result with per-item outcomes and a summary", async () => {
  outcomeById["ok-1"] = applied("approve", "ok-1");
  outcomeById["noop-1"] = { ok: true, kind: "noop", action: "approve", candidateId: "noop-1", reason: "already-approved", status: "QUEUED" };
  outcomeById["bad-1"] = { ok: false, reason: "illegal", action: "approve", candidateId: "bad-1", illegal: "has-article", status: "INGESTED" };
  const POST = await importBatch();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/review", { action: "approve", ids: ["ok-1", "noop-1", "bad-1"] }),
    undefined,
  );
  assert.equal(res.status, 200);
  const data = await readJson<{
    results: { candidateId: string; ok: boolean; outcome?: string; reason?: string }[];
    summary: { total: number; applied: number; noop: number; failed: number };
  }>(res);
  assert.deepEqual(data.summary, { total: 3, applied: 1, noop: 1, failed: 1 });
  assert.equal(data.results.length, 3);
  // Only the applied item was audited.
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0]?.targetId, "ok-1");
});

test("POST batch returns stale and not-found item shapes without auditing", async () => {
  outcomeById["stale-1"] = {
    ok: false,
    reason: "stale",
    action: "approve",
    candidateId: "stale-1",
    status: "NEEDS_REVIEW",
  };
  outcomeById["missing-1"] = {
    ok: false,
    reason: "not-found",
    action: "approve",
    candidateId: "missing-1",
  };
  const POST = await importBatch();
  const res = await POST(
    jsonPost("http://test/api/admin/candidates/review", {
      action: "approve",
      ids: ["stale-1", "missing-1"],
    }),
    undefined,
  );

  assert.equal(res.status, 200);
  const data = await readJson<{
    results: Array<Record<string, unknown>>;
    summary: { total: number; applied: number; noop: number; failed: number };
  }>(res);
  assert.deepEqual(data.results, [
    {
      candidateId: "stale-1",
      ok: false,
      reason: "stale",
      stale: true,
      status: "NEEDS_REVIEW",
    },
    { candidateId: "missing-1", ok: false, reason: "not-found" },
  ]);
  assert.deepEqual(data.summary, { total: 2, applied: 0, noop: 0, failed: 2 });
  assert.deepEqual(auditCalls, []);
});
