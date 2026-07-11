/**
 * Route tests for POST /api/reports (user content report) (issue #1001 batch 1).
 *
 * Covers: auth, validation (missing fields, invalid reason), successful report
 * creation with audit, service error propagation (404, 429).
 *
 * Mocks: @/lib/api-auth, @/lib/moderation/reports, @/lib/security/audit,
 *        @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type CreateResult = { ok: true; reportId: string } | { ok: false; error: string; status: number };
let createResult: CreateResult = { ok: true, reportId: "rpt-new" };
let createCallArgs: Record<string, unknown> | null = null;
let auditCalls: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/moderation/reports", {
    namedExports: {
      REPORT_REASONS: [
        "RIGHTS_COPYRIGHT",
        "UNSAFE_CONTENT",
        "EXTRACTION_BROKEN",
        "WRONG_LEVEL",
        "INACCURATE_AI",
        "CLASSROOM_CONCERN",
        "OTHER",
      ],
      createContentReport: async (input: Record<string, unknown>) => {
        createCallArgs = input;
        return createResult;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        userContentReport: "user.content_report",
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
  createResult = { ok: true, reportId: "rpt-new" };
  createCallArgs = null;
  auditCalls = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPORT_URL = "http://test/api/reports";

async function loadPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/reports/route")) as { POST: RouteHandler };
  return POST;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    articleId: "art-1",
    reason: "UNSAFE_CONTENT",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST /reports returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, validBody()));
  assert.equal(res.status, 401);
});

test("POST /reports returns 400 for missing articleId", async () => {
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, { reason: "UNSAFE_CONTENT" }));
  assert.equal(res.status, 400);
});

test("POST /reports returns 400 for invalid reason", async () => {
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, { articleId: "art-1", reason: "NOT_A_REASON" }));
  assert.equal(res.status, 400);
});

test("POST /reports creates report and returns 201 with audit", async () => {
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, validBody({ note: "Harmful" })));
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.reportId, "rpt-new");
  // Verify service received correct args
  assert.equal(createCallArgs?.reporterUserId, "user-1");
  assert.equal(createCallArgs?.articleId, "art-1");
  assert.equal(createCallArgs?.reason, "UNSAFE_CONTENT");
  assert.equal(createCallArgs?.note, "Harmful");
  // Audit recorded
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "user.content_report");
  assert.equal(auditCalls[0].targetType, "article");
  assert.equal(auditCalls[0].targetId, "art-1");
});

test("POST /reports propagates 404 from service (article not found)", async () => {
  createResult = { ok: false, error: "Article not found", status: 404 };
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, validBody()));
  assert.equal(res.status, 404);
});

test("POST /reports propagates 429 from dedup window", async () => {
  createResult = { ok: false, error: "Already reported", status: 429 };
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, validBody()));
  assert.equal(res.status, 429);
});

test("POST /reports accepts optional note as null", async () => {
  const handler = await loadPost();
  const res = await handler(jsonPost(REPORT_URL, validBody()));
  assert.equal(res.status, 201);
  assert.equal(createCallArgs?.note, null);
});
