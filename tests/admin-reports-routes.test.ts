/**
 * Route tests for admin content report moderation routes (issue #1001 batch 1).
 *
 * Covers:
 *   GET  /api/admin/reports        — list moderation queue (RBAC gated)
 *   PATCH /api/admin/reports/[id]  — resolve/dismiss report (RBAC + audit)
 *
 * Mocks: @/lib/api-auth, @/lib/moderation/reports, @/lib/security/audit,
 *        @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  type RouteHandler,
  getReq,
  jsonPatch,
  withParams,
} from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type ListResult = { reports: unknown[]; total: number; page: number; pageSize: number; pageCount: number };
let listResult: ListResult = { reports: [], total: 0, page: 1, pageSize: 25, pageCount: 0 };
let listCallQuery: { status?: string; page?: number; pageSize?: number } | null = null;

type UpdateResult =
  | { ok: true; reportId: string; status: string }
  | { ok: false; error: string; status: number };
let updateResult: UpdateResult = { ok: true, reportId: "rpt-1", status: "RESOLVED" };
let updateCallArgs: { reportId: string; status: string; resolvedBy: string } | null = null;
let auditCalls: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/moderation/reports", {
    namedExports: {
      ContentReportStatus: {
        OPEN: "OPEN",
        REVIEWING: "REVIEWING",
        RESOLVED: "RESOLVED",
        DISMISSED: "DISMISSED",
      },
      isReportStatus: (v: unknown) =>
        typeof v === "string" && ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"].includes(v),
      listContentReports: async (query: Record<string, unknown>) => {
        listCallQuery = query as typeof listCallQuery;
        return listResult;
      },
      updateReportStatus: async (args: { reportId: string; status: string; resolvedBy: string }) => {
        updateCallArgs = args;
        return updateResult;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminReportResolve: "admin.report.resolve",
        adminReportDismiss: "admin.report.dismiss",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async (input: Record<string, unknown>) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: Record<string, unknown>) => {
        auditCalls.push(input);
      },
    },
  });

  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "auth.unauthorized",
        forbidden: "auth.forbidden",
        adminAccessDenied: "auth.admin_denied",
        rateLimited: "rate_limit.exceeded",
        csrfBlocked: "csrf.blocked",
        adminMutation: "admin.mutation",
        importFailed: "import.failed",
        importBlocked: "import.blocked",
        suspiciousLookup: "lookup.suspicious_volume",
      },
      recordSecurityEvent: () => {},
    },
  });

  mock.module("@/lib/security/client-ip", {
    namedExports: {
      clientIp: () => "127.0.0.1",
      clientIpKey: () => "ip:127.0.0.1",
    },
  });
});

beforeEach(() => {
  authState = "ok";
  listResult = { reports: [], total: 0, page: 1, pageSize: 25, pageCount: 0 };
  listCallQuery = null;
  updateResult = { ok: true, reportId: "rpt-1", status: "RESOLVED" };
  updateCallArgs = null;
  auditCalls = [];
});

// ---------------------------------------------------------------------------
// GET /api/admin/reports
// ---------------------------------------------------------------------------

async function loadListGet(): Promise<RouteHandler> {
  const { GET } = (await import("@/app/api/admin/reports/route")) as { GET: RouteHandler };
  return GET;
}

test("GET /admin/reports returns 401 for unauthenticated users", async () => {
  authState = "unauth";
  const handler = await loadListGet();
  const res = await handler(getReq("http://test/api/admin/reports"));
  assert.equal(res.status, 401);
});

test("GET /admin/reports returns 403 for non-admin users", async () => {
  authState = "forbidden";
  const handler = await loadListGet();
  const res = await handler(getReq("http://test/api/admin/reports"));
  assert.equal(res.status, 403);
});

test("GET /admin/reports returns paginated list with default query", async () => {
  listResult = {
    reports: [{ id: "rpt-1", status: "OPEN" }],
    total: 1,
    page: 1,
    pageSize: 25,
    pageCount: 1,
  };
  const handler = await loadListGet();
  const res = await handler(getReq("http://test/api/admin/reports"));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.reports, [{ id: "rpt-1", status: "OPEN" }]);
  assert.equal(listCallQuery?.status, "OPEN");
});

test("GET /admin/reports passes status and page from query", async () => {
  const handler = await loadListGet();
  const res = await handler(getReq("http://test/api/admin/reports?status=RESOLVED&page=2&pageSize=10"));
  assert.equal(res.status, 200);
  assert.equal(listCallQuery?.status, "RESOLVED");
  assert.equal(listCallQuery?.page, 2);
  assert.equal(listCallQuery?.pageSize, 10);
});

test("GET /admin/reports defaults invalid status to OPEN", async () => {
  const handler = await loadListGet();
  await handler(getReq("http://test/api/admin/reports?status=INVALID"));
  assert.equal(listCallQuery?.status, "OPEN");
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/reports/[id]
// ---------------------------------------------------------------------------

async function loadPatch(): Promise<RouteHandler> {
  const { PATCH } = (await import("@/app/api/admin/reports/[id]/route")) as { PATCH: RouteHandler };
  return PATCH;
}

const PATCH_URL = "http://test/api/admin/reports/rpt-1";

test("PATCH /admin/reports/[id] returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "RESOLVED" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 401);
});

test("PATCH /admin/reports/[id] returns 403 for non-admin", async () => {
  authState = "forbidden";
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "RESOLVED" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 403);
});

test("PATCH /admin/reports/[id] returns 400 for invalid status", async () => {
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "INVALID" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 400);
});

test("PATCH /admin/reports/[id] resolves report and records audit", async () => {
  updateResult = { ok: true, reportId: "rpt-1", status: "RESOLVED" };
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "RESOLVED" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.status, "RESOLVED");
  assert.equal(updateCallArgs?.reportId, "rpt-1");
  assert.equal(updateCallArgs?.status, "RESOLVED");
  assert.equal(updateCallArgs?.resolvedBy, "admin-1");
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.report.resolve");
});

test("PATCH /admin/reports/[id] dismisses report with correct audit action", async () => {
  updateResult = { ok: true, reportId: "rpt-1", status: "DISMISSED" };
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "DISMISSED" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 200);
  assert.equal(auditCalls[0].action, "admin.report.dismiss");
});

test("PATCH /admin/reports/[id] returns error from service", async () => {
  updateResult = { ok: false, error: "Report not found", status: 404 };
  const handler = await loadPatch();
  const res = await handler(jsonPatch(PATCH_URL, { status: "RESOLVED" }), withParams({ id: "rpt-1" }));
  assert.equal(res.status, 404);
});
