/**
 * Route tests for the discovery-source admin API (#1089, Phase 1.9).
 *
 * Verifies the capability gate (`sources.manage`) is enforced for BOTH reads and
 * mutations (AC2): an unauthenticated caller gets 401, an authenticated caller
 * lacking the capability gets 403, and neither ever reaches the underlying lib.
 * Also verifies input validation (bad action/id → 400), the failure→status
 * mapping, and that a successful mutation records a sanitized audit entry with
 * NO URL/content/secret (AC4). `@/lib/api-auth`, `@/lib/security/audit`, and the
 * lib layer are mocked — no DB, no real auth.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { getReq, jsonPost, readJson, type RouteHandler, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let auditCalls: { action: string; metadata?: Record<string, unknown>; targetId?: string }[] = [];

let listCalls = 0;
let detailCalls: string[] = [];
let actionCalls: { id: string; action: string }[] = [];

let detailResult: unknown = {
  id: "src-1",
  providerKey: "undark",
  sourceKey: "feed",
  definitionVersion: 1,
  metrics: { status: "healthy-caught-up" },
};

let actionResult:
  | { ok: true; action: string; fromMode: string; toMode: string; queuedCount?: number; deferredCount?: number }
  | { ok: false; reason: string } = {
  ok: true,
  action: "pause",
  fromMode: "ACTIVE",
  toMode: "PAUSED",
};

const AUDIT_ACTIONS = {
  adminDiscoverySourceLifecycle: "admin.discovery_source.lifecycle",
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
      recordAuditFromRequest: async (input: { action: string; metadata?: Record<string, unknown>; targetId?: string }) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: { action: string }) => {
        auditCalls.push(input);
      },
    },
  });

  mock.module("@/lib/scraper/incremental/observability-query", {
    namedExports: {
      listDiscoverySourceMetrics: async () => {
        listCalls++;
        return [detailResult];
      },
      getDiscoverySourceMetrics: async (id: string) => {
        detailCalls.push(id);
        return detailResult;
      },
    },
  });

  mock.module("@/lib/scraper/incremental/lifecycle-actions", {
    namedExports: {
      LIFECYCLE_ACTIONS: ["begin-baseline", "activate", "pause", "resume", "rollback", "disable", "retire"],
      applyLifecycleAction: async (id: string, action: string) => {
        actionCalls.push({ id, action });
        return actionResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = 0;
  detailCalls = [];
  actionCalls = [];
  detailResult = {
    id: "src-1",
    providerKey: "undark",
    sourceKey: "feed",
    definitionVersion: 1,
    metrics: { status: "healthy-caught-up" },
  };
  actionResult = { ok: true, action: "pause", fromMode: "ACTIVE", toMode: "PAUSED" };
});

// ---- GET /api/admin/discovery-sources (list) -----------------------------

test("GET list requires the capability (401 unauth)", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/admin/discovery-sources/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources"));
  assert.equal(res.status, 401);
  assert.equal(listCalls, 0);
});

test("GET list denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/discovery-sources/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources"));
  assert.equal(res.status, 403);
  assert.equal(listCalls, 0);
});

test("GET list returns sources for an authorized caller", async () => {
  const { GET } = (await import("@/app/api/admin/discovery-sources/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources?lifecycleMode=ACTIVE&limit=10"));
  assert.equal(res.status, 200);
  assert.equal(listCalls, 1);
  const data = await readJson<{ sources: unknown[] }>(res);
  assert.equal(data.sources.length, 1);
});

// ---- GET /api/admin/discovery-sources/[id] (detail) ----------------------

test("GET detail denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/discovery-sources/[id]/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources/src-1"), withParams({ id: "src-1" }));
  assert.equal(res.status, 403);
  assert.equal(detailCalls.length, 0);
});

test("GET detail returns the metric summary", async () => {
  const { GET } = (await import("@/app/api/admin/discovery-sources/[id]/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources/src-1"), withParams({ id: "src-1" }));
  assert.equal(res.status, 200);
  assert.deepEqual(detailCalls, ["src-1"]);
});

test("GET detail returns 404 when the source is missing", async () => {
  detailResult = null;
  const { GET } = (await import("@/app/api/admin/discovery-sources/[id]/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/discovery-sources/nope"), withParams({ id: "nope" }));
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/discovery-sources/[id]/lifecycle (mutation) ---------

test("POST lifecycle requires the capability (401 unauth) and never runs the action", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "pause" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 401);
  assert.equal(actionCalls.length, 0);
});

test("POST lifecycle denies a caller missing the capability (403)", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "pause" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(actionCalls.length, 0);
});

test("POST lifecycle runs the action and audits a sanitized metadata entry", async () => {
  actionResult = { ok: true, action: "activate", fromMode: "SHADOW", toMode: "ACTIVE", queuedCount: 3, deferredCount: 2 };
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "activate" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(actionCalls, [{ id: "src-1", action: "activate" }]);
  const audit = auditCalls.at(-1);
  assert.equal(audit?.action, "admin.discovery_source.lifecycle");
  assert.equal(audit?.targetId, "src-1");
  // AC4: audit metadata is only ids/modes/counts — no URL/content/secret.
  const meta = JSON.stringify(audit?.metadata ?? {});
  assert.doesNotMatch(meta, /https?:\/\//);
  assert.match(meta, /"fromMode":"SHADOW"/);
  assert.match(meta, /"queuedCount":3/);
});

test("POST lifecycle rejects an unknown action (400) without running it", async () => {
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "explode" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(actionCalls.length, 0);
});

test("POST lifecycle maps a busy source to 409", async () => {
  actionResult = { ok: false, reason: "busy" };
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "pause" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 409);
  assert.equal(auditCalls.length, 0);
});

test("POST lifecycle maps a missing source to 404", async () => {
  actionResult = { ok: false, reason: "source-not-found" };
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/nope/lifecycle", { action: "pause" }),
    withParams({ id: "nope" }),
  );
  assert.equal(res.status, 404);
});

test("POST lifecycle maps an invalid transition to 409", async () => {
  actionResult = { ok: false, reason: "invalid-transition" };
  const { POST } = (await import("@/app/api/admin/discovery-sources/[id]/lifecycle/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/discovery-sources/src-1/lifecycle", { action: "activate" }),
    withParams({ id: "src-1" }),
  );
  assert.equal(res.status, 409);
});
