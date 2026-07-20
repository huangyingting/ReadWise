/**
 * Route tests for the canonical-conflict admin API (#1104, Phase 3.5).
 *
 * Verifies the capability gate (`sources.manage`) is enforced for the read
 * (list/detail) and the destructive resolve routes — 401 unauth, 403
 * missing-capability — and that a denied caller NEVER reaches the lib layer.
 * Also covers filter pass-through, the reason+confirm destructive guards, the
 * outcome→HTTP mapping (applied/noop 200, not-found 404, non-participant 400,
 * no-participants/stale 409+`stale`), the idempotent-noop-writes-NO-audit rule,
 * and that audit metadata is sanitized (ids/counts/reason category — no
 * URL/content). A source check proves the correct capability is wired.
 * `@/lib/api-auth`, `@/lib/security/audit`, and the lib layer are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };
type ResolveInput = {
  conflictId: string;
  survivingArticleId?: string;
  resolvedBy: string;
  migrateReaderData?: boolean;
  canonical?: "incumbent" | "challenger";
};

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];

let listCalls: unknown[] = [];
let detailCalls: string[] = [];
let resolveCalls: ResolveInput[] = [];

let listResult: unknown = {
  conflicts: [{ id: "cf-1", status: "OPEN", conflictingArticleIds: ["a1", "a2"] }],
  total: 1,
  offset: 0,
  limit: 50,
};
let detailResult: unknown = { id: "cf-1", status: "OPEN", conflictingArticleIds: ["a1", "a2"] };
let resolveResult: Record<string, unknown> = {
  ok: true,
  kind: "applied",
  conflictId: "cf-1",
  survivingArticleId: "a1",
  loserArticleIds: ["a2"],
  survivorCandidateId: "cand-1",
};

const AUDIT_ACTIONS = {
  adminCanonicalConflictResolve: "admin.canonical_conflict.resolve",
  adminArticleRecover: "admin.article.recover",
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

  mock.module("@/lib/scraper/incremental/canonical-conflict-query", {
    namedExports: {
      listCanonicalConflicts: async (filter: unknown) => {
        listCalls.push(filter);
        return listResult;
      },
      getCanonicalConflict: async (id: string) => {
        detailCalls.push(id);
        return detailResult;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/canonical-conflict-commit", {
    namedExports: {
      resolveCanonicalConflict: async (input: ResolveInput) => {
        resolveCalls.push(input);
        return resolveResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = [];
  detailCalls = [];
  resolveCalls = [];
  listResult = {
    conflicts: [{ id: "cf-1", status: "OPEN", conflictingArticleIds: ["a1", "a2"] }],
    total: 1,
    offset: 0,
    limit: 50,
  };
  detailResult = { id: "cf-1", status: "OPEN", conflictingArticleIds: ["a1", "a2"] };
  resolveResult = {
    ok: true,
    kind: "applied",
    conflictId: "cf-1",
    survivingArticleId: "a1",
    loserArticleIds: ["a2"],
    survivorCandidateId: "cand-1",
  };
});

const importList = async () =>
  ((await import("@/app/api/admin/canonical-conflicts/route")) as { GET: RouteHandler }).GET;
const importDetail = async () =>
  ((await import("@/app/api/admin/canonical-conflicts/[id]/route")) as { GET: RouteHandler }).GET;
const importResolve = async () =>
  ((await import("@/app/api/admin/canonical-conflicts/[id]/resolve/route")) as { POST: RouteHandler }).POST;

const resolveSource = readFileSync(
  new URL("../src/app/api/admin/canonical-conflicts/[id]/resolve/route.ts", import.meta.url),
  "utf8",
);

// ---- GET /api/admin/canonical-conflicts (list) ---------------------------

test("GET list requires the capability (401 unauth, never queries)", async () => {
  authState = "unauth";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts"));
  assert.equal(res.status, 401);
  assert.equal(listCalls.length, 0);
});

test("GET list denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts"));
  assert.equal(res.status, 403);
  assert.equal(listCalls.length, 0);
});

test("GET list returns the page and forwards sanitized filters", async () => {
  const GET = await importList();
  const res = await GET(
    getReq("http://test/api/admin/canonical-conflicts?status=RESOLVED&providerKey=undark&offset=10&limit=25"),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ total: number }>(res);
  assert.equal(data.total, 1);
  assert.deepEqual(listCalls[0], { status: "RESOLVED", providerKey: "undark", offset: 10, limit: 25 });
});

test("GET list ignores an unknown status filter (defaults to OPEN in the lib)", async () => {
  const GET = await importList();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts?status=BOGUS"));
  assert.equal(res.status, 200);
  assert.equal((listCalls[0] as { status?: string }).status, undefined);
});

// ---- GET /api/admin/canonical-conflicts/[id] (detail) --------------------

test("GET detail denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts/cf-1"), withParams({ id: "cf-1" }));
  assert.equal(res.status, 403);
  assert.equal(detailCalls.length, 0);
});

test("GET detail returns the sanitized conflict detail DTO", async () => {
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts/cf-1"), withParams({ id: "cf-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(detailCalls, ["cf-1"]);
  const data = await readJson<{ id: string }>(res);
  assert.equal(data.id, "cf-1");
});

test("GET detail returns 404 when the conflict is missing", async () => {
  detailResult = null;
  const GET = await importDetail();
  const res = await GET(getReq("http://test/api/admin/canonical-conflicts/nope"), withParams({ id: "nope" }));
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/canonical-conflicts/[id]/resolve --------------------

test("resolve route is gated on the sources.manage capability (source check)", () => {
  assert.match(resolveSource, /CAPABILITIES\.sourcesManage/);
  assert.match(resolveSource, /adminCanonicalConflictResolve/);
});

test("POST resolve requires the capability (401 unauth) and never runs the commit", async () => {
  authState = "unauth";
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve requires a reason (400) without running the commit", async () => {
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve requires explicit confirmation (400) without running the commit", async () => {
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: false }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve requires a surviving article id (400)", async () => {
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve rejects BOTH selectors at once (400) without running the commit", async () => {
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      survivingArticleId: "a1",
      canonical: "incumbent",
      reason: "r",
      confirm: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(resolveCalls.length, 0);
});

test("POST resolve applies, returns 200, and audits sanitized metadata (no URL/content)", async () => {
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      survivingArticleId: "a1",
      reason: "operator kept the canonical copy",
      confirm: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; survivingArticleId: string; loserArticleIds: string[] }>(res);
  assert.equal(data.outcome, "applied");
  assert.equal(data.survivingArticleId, "a1");
  assert.deepEqual(data.loserArticleIds, ["a2"]);
  assert.deepEqual(resolveCalls[0], {
    conflictId: "cf-1",
    survivingArticleId: "a1",
    resolvedBy: "admin-1",
    migrateReaderData: false,
  });

  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.canonical_conflict.resolve");
  assert.equal(audit?.targetType, "canonical_conflict");
  assert.equal(audit?.targetId, "cf-1");
  assert.equal((audit?.metadata as { loserArticleCount?: number })?.loserArticleCount, 1);
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
});

test("POST resolve forwards the opt-in migrateReaderData flag and surfaces migration counts (#1134)", async () => {
  resolveResult = {
    ok: true,
    kind: "applied",
    conflictId: "cf-1",
    survivingArticleId: "a1",
    loserArticleIds: ["a2"],
    survivorCandidateId: "cand-1",
    migration: {
      readingProgress: { repointed: 2, merged: 1, skipped: 0 },
      readingListItems: { repointed: 0, merged: 0, skipped: 0 },
      highlights: { repointed: 3, merged: 1, skipped: 2 },
      articleMastery: { repointed: 1, merged: 0, skipped: 0 },
      difficultyFeedback: { repointed: 0, merged: 0, skipped: 0 },
      tutorMessages: { repointed: 5, merged: 0, skipped: 0 },
      quizAttempts: { repointed: 0, merged: 0, skipped: 0 },
      pronunciationAttempts: { repointed: 0, merged: 0, skipped: 0 },
    },
  };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      survivingArticleId: "a1",
      reason: "operator kept the canonical copy and migrated reader data",
      confirm: true,
      migrateReaderData: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{
    outcome: string;
    migration?: { highlights?: { skipped?: number } };
  }>(res);
  assert.equal(data.outcome, "applied");
  assert.equal(data.migration?.highlights?.skipped, 2, "migration counts surfaced in the response");

  assert.equal(resolveCalls[0]?.migrateReaderData, true, "opt-in flag forwarded to the resolver");

  const audit = auditCalls.at(-1);
  const meta = audit?.metadata as {
    migrateReaderData?: boolean;
    migration?: { highlights?: { skipped?: number } };
  };
  assert.equal(meta?.migrateReaderData, true);
  assert.equal(meta?.migration?.highlights?.skipped, 2, "audit records migration counts");
  // Privacy: metadata carries counts/ids/booleans only — never a URL or content.
  assert.doesNotMatch(JSON.stringify(audit?.metadata ?? {}), /https?:\/\//);
});

test("POST resolve noop is a 200 that writes NO audit (idempotent)", async () => {
  resolveResult = { ok: true, kind: "noop", conflictId: "cf-1", reason: "already-resolved", status: "RESOLVED" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; reason: string }>(res);
  assert.equal(data.outcome, "noop");
  assert.equal(data.reason, "already-resolved");
  assert.equal(auditCalls.length, 0);
});

test("POST resolve non-participant survivor maps to 400 with NO audit", async () => {
  resolveResult = { ok: false, reason: "illegal", conflictId: "cf-1", illegal: "survivor-not-a-participant", status: "OPEN" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "zzz", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 400);
  const data = await readJson<{ reason: string; detail: string }>(res);
  assert.equal(data.detail, "survivor-not-a-participant");
  assert.equal(auditCalls.length, 0);
});

test("POST resolve no-participants maps to 409", async () => {
  resolveResult = { ok: false, reason: "illegal", conflictId: "cf-1", illegal: "no-participants", status: "OPEN" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 409);
});

test("POST resolve stale maps to 409 with stale:true", async () => {
  resolveResult = { ok: false, reason: "stale", conflictId: "cf-1", status: "DISMISSED" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ stale: boolean }>(res);
  assert.equal(data.stale, true);
});

test("POST resolve not-found maps to 404", async () => {
  resolveResult = { ok: false, reason: "not-found", conflictId: "cf-1" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { survivingArticleId: "a1", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Type B (runtime) resolution branch (#1135)
// ---------------------------------------------------------------------------

test("POST resolve forwards the Type-B canonical selector ONLY (no Type-A keys) and returns 200", async () => {
  resolveResult = {
    ok: true,
    kind: "applied-type-b",
    conflictId: "cf-1",
    canonical: "challenger",
    winnerCandidateId: "cand-chal",
    loserCandidateId: "cand-inc",
    archivedArticleId: "art-inc",
  };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      canonical: "challenger",
      reason: "operator promoted the challenger",
      confirm: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ outcome: string; canonical: string; winnerCandidateId: string; archivedArticleId: string }>(res);
  assert.equal(data.outcome, "applied-type-b");
  assert.equal(data.canonical, "challenger");
  assert.equal(data.winnerCandidateId, "cand-chal");
  assert.equal(data.archivedArticleId, "art-inc");
  // Only the Type-B shape is forwarded — never a stray survivingArticleId / migrateReaderData.
  assert.deepEqual(resolveCalls[0], {
    conflictId: "cf-1",
    resolvedBy: "admin-1",
    canonical: "challenger",
  });
});

test("POST resolve Type-B applied audits sanitized metadata (type-b, counts/ids/booleans — no URL/content)", async () => {
  resolveResult = {
    ok: true,
    kind: "applied-type-b",
    conflictId: "cf-1",
    canonical: "challenger",
    winnerCandidateId: "cand-chal",
    loserCandidateId: "cand-inc",
    archivedArticleId: "art-inc",
  };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      canonical: "challenger",
      reason: "operator promoted the challenger",
      confirm: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);

  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.canonical_conflict.resolve");
  assert.equal(audit?.targetType, "canonical_conflict");
  assert.equal(audit?.targetId, "cf-1");
  const meta = audit?.metadata as {
    conflictType?: string;
    canonical?: string;
    winnerCandidateId?: string;
    loserCandidateId?: string;
    incumbentArticleArchived?: boolean;
    survivingArticleId?: unknown;
  };
  assert.equal(meta?.conflictType, "type-b");
  assert.equal(meta?.canonical, "challenger");
  assert.equal(meta?.winnerCandidateId, "cand-chal");
  assert.equal(meta?.loserCandidateId, "cand-inc");
  assert.equal(meta?.incumbentArticleArchived, true);
  // No Type-A leakage, no URL/content.
  assert.equal(meta?.survivingArticleId, undefined);
  assert.doesNotMatch(JSON.stringify(audit?.metadata ?? {}), /https?:\/\//);
});

test("POST resolve Type-B with no incumbent Article records incumbentArticleArchived:false", async () => {
  resolveResult = {
    ok: true,
    kind: "applied-type-b",
    conflictId: "cf-1",
    canonical: "challenger",
    winnerCandidateId: "cand-chal",
    loserCandidateId: "cand-inc",
    archivedArticleId: null,
  };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", {
      canonical: "challenger",
      reason: "operator promoted the challenger",
      confirm: true,
    }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 200);
  const meta = auditCalls.at(-1)?.metadata as { incumbentArticleArchived?: boolean };
  assert.equal(meta?.incumbentArticleArchived, false);
});

test("POST resolve wrong-conflict-type maps to 409 with NO audit", async () => {
  resolveResult = { ok: false, reason: "illegal", conflictId: "cf-1", illegal: "wrong-conflict-type", status: "OPEN" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { canonical: "incumbent", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string; detail: string }>(res);
  assert.equal(data.detail, "wrong-conflict-type");
  assert.equal(auditCalls.length, 0);
});

test("POST resolve challenger-candidate-missing maps to 409", async () => {
  resolveResult = { ok: false, reason: "illegal", conflictId: "cf-1", illegal: "challenger-candidate-missing", status: "OPEN" };
  const POST = await importResolve();
  const res = await POST(
    jsonPost("http://test/api/admin/canonical-conflicts/cf-1/resolve", { canonical: "challenger", reason: "r", confirm: true }),
    withParams({ id: "cf-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ detail: string }>(res);
  assert.equal(data.detail, "challenger-candidate-missing");
});
