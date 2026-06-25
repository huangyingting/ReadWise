process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

let authState: "ok" | "unauth" | "forbidden" = "ok";
let auditCalls: unknown[] = [];
let listCalls = 0;
let deleteArticleResult = true;
let deleteArticleThrows = false;
let revalidateCalls = 0;

const session = { user: { id: "admin-1", role: "Admin", name: "Admin", email: null } };
const readerSession = { user: { id: "reader-1", role: "Reader", name: "Reader", email: null } };
const AUDIT_ACTIONS = {
  adminArticleDelete: "admin.article.delete",
  securityAdminAccessDenied: "security.admin_access_denied",
  adminAuditLogRead: "admin.audit_logs.read",
};

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () => {
        if (authState === "unauth") {
          return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
        }
        if (authState === "forbidden") {
          return {
            session: readerSession,
            error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
          };
        }
        return { session };
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS,
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: unknown) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: unknown) => {
        auditCalls.push(input);
      },
      listAuditLogs: async () => {
        listCalls++;
        return {
          logs: [{ id: "audit-1", action: "admin.article.delete", metadata: {} }],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        };
      },
    },
  });

  // api-handler.ts imports directly from @/lib/security/audit; mirror the same
  // mock so tryRecordAuditLog calls from the handler are captured in auditCalls.
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS,
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: unknown) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: unknown) => {
        auditCalls.push(input);
      },
      listAuditLogs: async () => {
        listCalls++;
        return {
          logs: [{ id: "audit-1", action: "admin.article.delete", metadata: {} }],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        };
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      deleteArticle: async (_id: string, _ctx: unknown, audit?: unknown) => {
        if (!deleteArticleResult) return false;
        if (deleteArticleThrows) throw new Error("audit unavailable");
        if (audit) auditCalls.push(audit);
        return true;
      },
      articleAccessContext: () => ({ role: "Admin", userId: "admin-1" }),
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateTagsCache: () => {
        revalidateCalls++;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = 0;
  deleteArticleResult = true;
  deleteArticleThrows = false;
  revalidateCalls = 0;
});

function ctx(id = "article-1") {
  return { params: Promise.resolve({ id }) };
}

test("admin audit log API requires admin", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/audit-logs/route")) as { GET: RouteHandler };

  const res = await GET(new Request("http://test/api/admin/audit-logs"), undefined);

  assert.equal(res.status, 403);
  assert.equal(listCalls, 0);
  const audit = auditCalls[0] as { action: string; actorId: string; actorRole: string };
  assert.equal(audit.action, "security.admin_access_denied");
  assert.equal(audit.actorId, "reader-1");
  assert.equal(audit.actorRole, "Reader");
});

test("admin audit log API returns audit entries for admins", async () => {
  const { GET } = (await import("@/app/api/admin/audit-logs/route")) as { GET: RouteHandler };

  const res = await GET(new Request("http://test/api/admin/audit-logs?pageSize=10"), undefined);

  assert.equal(res.status, 200);
  assert.equal((await res.json()).total, 1);
  assert.equal(listCalls, 1);
  assert.equal((auditCalls[0] as { action: string }).action, "admin.audit_logs.read");
});

test("admin article deletion writes an audit record with request context", async () => {
  const { DELETE } = (await import("@/app/api/admin/articles/[id]/route")) as { DELETE: RouteHandler };

  const res = await DELETE(
    new Request("http://test/api/admin/articles/article-1", {
      method: "DELETE",
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "AuditRouteTest/1.0",
        "x-request-id": "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    ctx("article-1"),
  );

  assert.equal(res.status, 200);
  assert.equal(revalidateCalls, 1);
  const audit = auditCalls[0] as {
    action: string;
    targetType: string;
    targetId: string;
    session: typeof session;
    requestId: string;
  };
  assert.equal(audit.action, "admin.article.delete");
  assert.equal(audit.targetType, "article");
  assert.equal(audit.targetId, "article-1");
  assert.equal(audit.session.user.id, "admin-1");
  assert.equal(audit.requestId, "550e8400-e29b-41d4-a716-446655440000");
});

test("admin article deletion returns 500 and skips cache invalidation when atomic audit write fails", async () => {
  deleteArticleThrows = true;
  const { DELETE } = (await import("@/app/api/admin/articles/[id]/route")) as { DELETE: RouteHandler };

  const res = await DELETE(
    new Request("http://test/api/admin/articles/article-1", { method: "DELETE" }),
    ctx("article-1"),
  );

  assert.equal(res.status, 500);
  assert.equal(revalidateCalls, 0);
});

test("admin article deletion does not audit failed not-found deletes", async () => {
  deleteArticleResult = false;
  const { DELETE } = (await import("@/app/api/admin/articles/[id]/route")) as { DELETE: RouteHandler };

  const res = await DELETE(new Request("http://test/api/admin/articles/missing", { method: "DELETE" }), ctx("missing"));

  assert.equal(res.status, 404);
  assert.equal(auditCalls.length, 0);
  assert.equal(revalidateCalls, 0);
});
