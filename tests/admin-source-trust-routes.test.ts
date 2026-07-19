/**
 * Route tests for the source-trust-promotion admin API (#1100, Phase 3.1).
 *
 * Verifies the capability gate (`sources.manage`) for the GET snapshot and the
 * POST promote/demote mutation (401 unauth, 403 missing-capability, never
 * reaching the lib on denial), input validation (bad action / missing version /
 * missing reason → 400), the failure→status mapping (source-not-found 404;
 * version-mismatch/busy/ineligible/stale 409, ineligible carrying `blockers`),
 * the idempotent-noop-writes-NO-audit rule, and that a state-CHANGING promote/
 * demote records a sanitized audit entry with actor/version/before/after/reason/
 * evidence and NO private content. `@/lib/api-auth`, `@/lib/security/audit`, and
 * the lib layer are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditCall = { action: string; metadata?: Record<string, unknown>; targetId?: string; targetType?: string };
type TrustInput = { sourceId: string; definitionVersion: number };

let authState: AuthState = "ok";
let auditCalls: AuditCall[] = [];
let snapshotCalls: string[] = [];
let promoteCalls: TrustInput[] = [];
let demoteCalls: TrustInput[] = [];

function policy(trusted: boolean) {
  return { autoPublishTrusted: trusted, canRepublishPublicly: false, canFetchAuthenticated: false };
}

function evidence() {
  return {
    sampleSize: 25,
    acceptedCount: 18,
    reviewRejectedCount: 2,
    decidedCount: 20,
    approvalRate: 0.9,
    oldItemFalsePositives: 0,
    oldItemFalsePositiveRate: 0,
    drift: { zeroDiscoveryStreak: 0, consecutiveFailures: 0, volumeAnomaly: "none", conflictRate: 0, oldItemFalsePositives: 0 },
  };
}

let snapshotResult: unknown = {
  id: "src-1",
  providerKey: "undark",
  sourceKey: "feed",
  definitionVersion: 1,
  lifecycleMode: "ACTIVE",
  policy: policy(false),
  evidence: evidence(),
  eligibility: { eligible: true, blockers: [], warnings: [], evidence: evidence() },
};

let promoteResult: Record<string, unknown> = {
  ok: true,
  action: "promote",
  changed: true,
  sourceId: "src-1",
  definitionVersion: 1,
  before: policy(false),
  after: policy(true),
  evidence: evidence(),
};

let demoteResult: Record<string, unknown> = {
  ok: true,
  action: "demote",
  changed: true,
  sourceId: "src-1",
  definitionVersion: 1,
  before: policy(true),
  after: policy(false),
  evidence: evidence(),
};

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

  mock.module("@/lib/scraper/incremental/source-trust-query", {
    namedExports: {
      getSourceTrustSnapshot: async (id: string) => {
        snapshotCalls.push(id);
        return snapshotResult;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/source-trust-commit", {
    namedExports: {
      promoteSourceTrust: async (input: TrustInput) => {
        promoteCalls.push(input);
        return promoteResult;
      },
      demoteSourceTrust: async (input: TrustInput) => {
        demoteCalls.push(input);
        return demoteResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  snapshotCalls = [];
  promoteCalls = [];
  demoteCalls = [];
  snapshotResult = {
    id: "src-1",
    providerKey: "undark",
    sourceKey: "feed",
    definitionVersion: 1,
    lifecycleMode: "ACTIVE",
    policy: policy(false),
    evidence: evidence(),
    eligibility: { eligible: true, blockers: [], warnings: [], evidence: evidence() },
  };
  promoteResult = {
    ok: true,
    action: "promote",
    changed: true,
    sourceId: "src-1",
    definitionVersion: 1,
    before: policy(false),
    after: policy(true),
    evidence: evidence(),
  };
  demoteResult = {
    ok: true,
    action: "demote",
    changed: true,
    sourceId: "src-1",
    definitionVersion: 1,
    before: policy(true),
    after: policy(false),
    evidence: evidence(),
  };
});

const importTrust = async () =>
  (await import("@/app/api/admin/discovery-sources/[id]/trust/route")) as { GET: RouteHandler; POST: RouteHandler };

// ---- GET /api/admin/discovery-sources/[id]/trust (snapshot) --------------

test("GET trust requires the capability (401 unauth, never queries)", async () => {
  authState = "unauth";
  const { GET } = await importTrust();
  const res = await GET(getReq("http://test/api/admin/discovery-sources/src-1/trust"), withParams({ id: "src-1" }));
  assert.equal(res.status, 401);
  assert.equal(snapshotCalls.length, 0);
});

test("GET trust denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const { GET } = await importTrust();
  const res = await GET(getReq("http://test/api/admin/discovery-sources/src-1/trust"), withParams({ id: "src-1" }));
  assert.equal(res.status, 403);
  assert.equal(snapshotCalls.length, 0);
});

test("GET trust returns the sanitized snapshot (policy + evidence + eligibility)", async () => {
  const { GET } = await importTrust();
  const res = await GET(getReq("http://test/api/admin/discovery-sources/src-1/trust"), withParams({ id: "src-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(snapshotCalls, ["src-1"]);
  const data = await readJson<{ source: { eligibility: { eligible: boolean } } }>(res);
  assert.equal(data.source.eligibility.eligible, true);
});

test("GET trust returns 404 when the source is missing", async () => {
  snapshotResult = null;
  const { GET } = await importTrust();
  const res = await GET(getReq("http://test/api/admin/discovery-sources/nope/trust"), withParams({ id: "nope" }));
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/discovery-sources/[id]/trust (promote/demote) --------

test("POST trust requires the capability (401 unauth) and never runs a commit", async () => {
  authState = "unauth";
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "proven" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(promoteCalls.length, 0);
});

test("POST trust denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "proven" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(promoteCalls.length, 0);
});

test("POST trust rejects an unknown action (400)", async () => {
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "bless", definitionVersion: 1, reason: "x" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(promoteCalls.length, 0);
});

test("POST trust requires a reason (400)", async () => {
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1 }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(promoteCalls.length, 0);
});

test("POST trust requires a definitionVersion (400)", async () => {
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", reason: "proven" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(promoteCalls.length, 0);
});

test("POST trust promote (changed) returns 200 and audits actor/version/before-after/evidence — no private content", async () => {
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "proven over 20 samples" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(promoteCalls, [{ sourceId: "src-1", definitionVersion: 1 }]);
  const data = await readJson<{ ok: boolean; changed: boolean; after: { autoPublishTrusted: boolean } }>(res);
  assert.equal(data.changed, true);
  assert.equal(data.after.autoPublishTrusted, true);
  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.source.trust_promotion");
  assert.equal(audit?.targetId, "src-1");
  const meta = audit?.metadata as Record<string, unknown>;
  assert.equal((meta.before as { autoPublishTrusted: boolean }).autoPublishTrusted, false);
  assert.equal((meta.after as { autoPublishTrusted: boolean }).autoPublishTrusted, true);
  assert.equal(meta.definitionVersion, 1);
  assert.equal(meta.reason, "proven over 20 samples");
  assert.ok(meta.evidence, "evidence summary present");
  const metaStr = JSON.stringify(meta);
  assert.doesNotMatch(metaStr, /https?:\/\//);
});

test("POST trust promote (idempotent, changed:false) writes NO audit", async () => {
  promoteResult = { ...promoteResult, changed: false, before: policy(true), after: policy(true) };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "already" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 200);
  const data = await readJson<{ changed: boolean }>(res);
  assert.equal(data.changed, false);
  assert.equal(auditCalls.length, 0);
});

test("POST trust promote ineligible maps to 409 with the blockers (no audit)", async () => {
  promoteResult = { ok: false, action: "promote", sourceId: "src-1", reason: "ineligible", blockers: ["old-item-false-positive", "low-approval-rate"] };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "try" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string; blockers: string[] }>(res);
  assert.equal(data.reason, "ineligible");
  assert.deepEqual(data.blockers, ["old-item-false-positive", "low-approval-rate"]);
  assert.equal(auditCalls.length, 0);
});

test("POST trust promote version-mismatch maps to 409 (version-scoped)", async () => {
  promoteResult = { ok: false, action: "promote", sourceId: "src-1", reason: "version-mismatch" };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "stale version" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 409);
  const data = await readJson<{ reason: string }>(res);
  assert.equal(data.reason, "version-mismatch");
});

test("POST trust promote source-not-found maps to 404", async () => {
  promoteResult = { ok: false, action: "promote", sourceId: "nope", reason: "source-not-found" };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/nope/trust", { action: "promote", definitionVersion: 1, reason: "x" }),
    withParams({ id: "nope" }),
  );
  assert.equal(res.status, 404);
});

test("POST trust promote busy maps to 409", async () => {
  promoteResult = { ok: false, action: "promote", sourceId: "src-1", reason: "busy" };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "promote", definitionVersion: 1, reason: "x" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 409);
});

test("POST trust demote (changed) returns 200, includes toMode, and audits", async () => {
  demoteResult = { ...demoteResult, toMode: "SHADOW" };
  const { POST } = await importTrust();
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/trust", { action: "demote", definitionVersion: 1, reason: "manual revoke" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(demoteCalls, [{ sourceId: "src-1", definitionVersion: 1 }]);
  const data = await readJson<{ changed: boolean; toMode?: string; after: { autoPublishTrusted: boolean } }>(res);
  assert.equal(data.changed, true);
  assert.equal(data.toMode, "SHADOW");
  assert.equal(data.after.autoPublishTrusted, false);
  assert.equal(auditCalls.at(-1)?.action, "admin.source.trust_promotion");
});
