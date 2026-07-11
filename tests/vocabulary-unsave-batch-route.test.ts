/**
 * Route tests for POST /api/vocabulary/unsave-batch (issue #995).
 *
 * Covers: user scoping, bounded/invalid input, empty/partial/missing words,
 * atomic delete semantics, no cross-user deletion.
 *
 * Mocks: @/lib/api-auth, @/lib/prisma, @/lib/security/events,
 *        @/lib/security/client-ip.
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
let deleteManyCalls: Array<{ where: { userId: string; word: { in: string[] } } }> = [];
let deleteManyResult = { count: 3 };

const UNSAVE_URL = "http://test/api/vocabulary/unsave-batch";

function unsaveRequest(body: unknown) {
  return jsonPost(UNSAVE_URL, body);
}

async function loadPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/vocabulary/unsave-batch/route")) as {
    POST: RouteHandler;
  };
  return POST;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        savedWord: {
          deleteMany: async (args: { where: { userId: string; word: { in: string[] } } }) => {
            deleteManyCalls.push(args);
            return deleteManyResult;
          },
        },
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

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {},
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async () => {},
      tryRecordAuditLog: async () => {},
    },
  });
});

beforeEach(() => {
  authState = "ok";
  deleteManyCalls = [];
  deleteManyResult = { count: 3 };
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test("POST /api/vocabulary/unsave-batch returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const POST = await loadPost();
  const res = await POST(unsaveRequest({ words: ["hello"] }), undefined);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test("POST /api/vocabulary/unsave-batch returns 400 for missing words", async () => {
  const POST = await loadPost();
  const res = await POST(unsaveRequest({}), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/vocabulary/unsave-batch returns 200 with 0 removed for empty words array", async () => {
  deleteManyResult = { count: 0 };
  const POST = await loadPost();
  const res = await POST(unsaveRequest({ words: [] }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 0);
});

test("POST /api/vocabulary/unsave-batch returns 400 for words exceeding batch limit", async () => {
  const POST = await loadPost();
  const tooMany = Array.from({ length: 201 }, (_, i) => `word${i}`);
  const res = await POST(unsaveRequest({ words: tooMany }), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/vocabulary/unsave-batch returns 400 for empty string in words", async () => {
  const POST = await loadPost();
  const res = await POST(unsaveRequest({ words: ["hello", ""] }), undefined);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// User scoping / no cross-user deletion
// ---------------------------------------------------------------------------

test("POST /api/vocabulary/unsave-batch scopes delete to authenticated user", async () => {
  const POST = await loadPost();
  await POST(unsaveRequest({ words: ["apple", "banana"] }), undefined);
  assert.equal(deleteManyCalls.length, 1);
  // Session user id from readerSession is "user-1"
  assert.equal(deleteManyCalls[0].where.userId, "user-1");
  assert.deepEqual(deleteManyCalls[0].where.word.in, ["apple", "banana"]);
});

// ---------------------------------------------------------------------------
// Partial / missing words (silently skipped)
// ---------------------------------------------------------------------------

test("POST /api/vocabulary/unsave-batch returns 0 removed for missing words", async () => {
  deleteManyResult = { count: 0 };
  const POST = await loadPost();
  const res = await POST(unsaveRequest({ words: ["nonexistent"] }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 0);
});

test("POST /api/vocabulary/unsave-batch returns partial count for mix of existing/missing", async () => {
  deleteManyResult = { count: 2 };
  const POST = await loadPost();
  const res = await POST(unsaveRequest({ words: ["exists1", "exists2", "missing"] }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 2);
});

// ---------------------------------------------------------------------------
// Success / atomic delete semantics
// ---------------------------------------------------------------------------

test("POST /api/vocabulary/unsave-batch returns removed count on success", async () => {
  deleteManyResult = { count: 5 };
  const POST = await loadPost();
  const res = await POST(
    unsaveRequest({ words: ["a", "b", "c", "d", "e"] }),
    undefined,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 5);
});

test("POST /api/vocabulary/unsave-batch accepts max batch size (200)", async () => {
  deleteManyResult = { count: 200 };
  const POST = await loadPost();
  const words = Array.from({ length: 200 }, (_, i) => `word${i}`);
  const res = await POST(unsaveRequest({ words }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 200);
});
