/**
 * Route tests for POST /api/admin/articles/[id]/rebuild (issue #1001 batch 1).
 *
 * Covers: auth/capability (articlesManage), 404 not-found, successful rebuild
 * with cache revalidation and audit callback invocation.
 *
 * Mocks: @/lib/api-auth, @/lib/article-library, @/lib/cache,
 *        @/lib/security/audit, @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type RebuildResult = { cleared: Record<string, number> } | null;
let rebuildResult: RebuildResult = { cleared: { quiz: 2, summary: 1 } };
let rebuildCallArgs: { id: string } | null = null;
let auditCalls: Array<Record<string, unknown>> = [];
let cacheRevalidated = false;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: (user: { id: string; role: string }) => ({
        userId: user.id,
        role: user.role,
      }),
      rebuildArticleAi: async (
        id: string,
        _context: unknown,
        auditFactory?: (result: { cleared: Record<string, number> }) => unknown,
      ) => {
        rebuildCallArgs = { id };
        if (rebuildResult && auditFactory) {
          const input = auditFactory(rebuildResult);
          auditCalls.push(input as Record<string, unknown>);
        }
        return rebuildResult;
      },
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateTagsCache: () => {
        cacheRevalidated = true;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminArticleRebuild: "admin.article.rebuild_ai",
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
  rebuildResult = { cleared: { quiz: 2, summary: 1 } };
  rebuildCallArgs = null;
  auditCalls = [];
  cacheRevalidated = false;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REBUILD_URL = "http://test/api/admin/articles/art-1/rebuild";

async function loadPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/admin/articles/[id]/rebuild/route")) as {
    POST: RouteHandler;
  };
  return POST;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST /admin/articles/[id]/rebuild returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadPost();
  const res = await handler(jsonPost(REBUILD_URL, {}), withParams({ id: "art-1" }));
  assert.equal(res.status, 401);
});

test("POST /admin/articles/[id]/rebuild returns 403 for non-admin", async () => {
  authState = "forbidden";
  const handler = await loadPost();
  const res = await handler(jsonPost(REBUILD_URL, {}), withParams({ id: "art-1" }));
  assert.equal(res.status, 403);
});

test("POST /admin/articles/[id]/rebuild returns 404 for unknown article", async () => {
  rebuildResult = null;
  const handler = await loadPost();
  const res = await handler(jsonPost(REBUILD_URL, {}), withParams({ id: "art-1" }));
  assert.equal(res.status, 404);
});

test("POST /admin/articles/[id]/rebuild succeeds and revalidates cache", async () => {
  const handler = await loadPost();
  const res = await handler(jsonPost(REBUILD_URL, {}), withParams({ id: "art-1" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.cleared, { quiz: 2, summary: 1 });
  assert.equal(rebuildCallArgs?.id, "art-1");
  assert.equal(cacheRevalidated, true);
});

test("POST /admin/articles/[id]/rebuild invokes audit callback with article context", async () => {
  const handler = await loadPost();
  await handler(jsonPost(REBUILD_URL, {}), withParams({ id: "art-1" }));
  assert.ok(auditCalls.length >= 1);
  const audit = auditCalls[0];
  assert.equal(audit.action, "admin.article.rebuild_ai");
  assert.equal(audit.targetType, "article");
  assert.equal(audit.targetId, "art-1");
});
