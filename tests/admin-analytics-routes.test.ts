/**
 * Route tests for the admin analytics export + member-support APIs
 * (RW-052 / RW-053). Verifies capability gating (a session lacking the
 * capability gets 403 and the underlying lib is never called), and that the
 * happy paths invoke the lib + record an audit entry. `@/lib/api-auth`,
 * `@/lib/audit`, `@/lib/analytics-queries` and `@/lib/account-lifecycle` are
 * mocked — no DB, no real auth.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

let authState: "ok" | "unauth" | "forbidden" = "ok";
let auditCalls: { action: string }[] = [];

// admin-member-detail spies + canned results
let revokeCalls = 0;
let exportCalls = 0;
let repairCalls = 0;
let resendCalls = 0;
let revokeResult: unknown = { ok: true, revoked: 2 };

const session = { user: { id: "admin-1", role: "Admin", name: "Admin", email: null } };
const readerSession = { user: { id: "reader-1", role: "Reader", name: "Reader", email: null } };

const AUDIT_ACTIONS = {
  adminMemberRevokeSessions: "admin.member.revoke_sessions",
  adminMemberExport: "admin.member.export",
  adminMemberRepair: "admin.member.repair",
  adminMemberResendHelp: "admin.member.resend_help",
  securityAdminAccessDenied: "security.admin_access_denied",
};

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () => gate(),
      requireCapabilityApi: async () => gate(),
    },
  });

  mock.module("@/lib/audit", {
    namedExports: {
      AUDIT_ACTIONS,
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: { action: string }) => {
        auditCalls.push(input);
      },
    },
  });

  mock.module("@/lib/analytics/product", {
    namedExports: {
      resolveTimeRange: (days: number) => ({
        since: new Date("2026-06-01T00:00:00Z"),
        until: new Date("2026-06-22T00:00:00Z"),
        days: days || 30,
      }),
      getAnalyticsOverview: async () => ({
        funnel: [
          {
            key: "onboarding_complete",
            label: "Onboarding complete",
            users: 2,
            conversionFromPrevPct: 100,
            conversionFromStartPct: 100,
          },
        ],
        activation: { numerator: 1, denominator: 2, ratePct: 50 },
        readingCompletion: { numerator: 1, denominator: 2, ratePct: 50 },
        studyConversion: { numerator: 0, denominator: 1, ratePct: 0 },
        featureUsage: [{ type: "article_view", label: "Article views", users: 2, events: 4 }],
        totals: { events: 4, users: 2 },
        segmentUserCount: null,
      }),
      getRetentionCohorts: async () => [
        {
          cohortWeek: "2026-06-01",
          size: 2,
          cells: [{ offset: 0, count: 2, pct: 100 }],
        },
      ],
    },
  });

  mock.module("@/lib/account-lifecycle", {
    namedExports: {
      revokeMemberSessions: async (_id: string, audit?: (r: unknown) => { action: string }) => {
        revokeCalls++;
        if (audit) auditCalls.push(audit({ revoked: 2 }));
        return revokeResult;
      },
      exportMemberData: async (_id: string, audit?: { action: string }) => {
        exportCalls++;
        if (audit) auditCalls.push(audit);
        return { ok: true, data: { user: { id: _id } } };
      },
      triggerMemberRepair: async (
        _id: string,
        _operatorId: string | null,
        audit?: (r: unknown) => { action: string },
      ) => {
        repairCalls++;
        if (audit) auditCalls.push(audit({ result: { enqueued: 3, skippedExisting: 0 }, articleCount: 2 }));
        return { ok: true, result: { enqueued: 3 }, articleCount: 2 };
      },
      resendSignInHelp: async (_id: string, audit?: (r: unknown) => { action: string }) => {
        resendCalls++;
        if (audit) auditCalls.push(audit({ delivered: false }));
        return { ok: true, delivered: false, reason: "email_not_configured" };
      },
    },
  });
});

function gate() {
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
}

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  revokeCalls = 0;
  exportCalls = 0;
  repairCalls = 0;
  resendCalls = 0;
  revokeResult = { ok: true, revoked: 2 };
});

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- GET /api/admin/analytics/export ------------------------------------

test("export requires the analytics.view capability", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/analytics/export/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/admin/analytics/export?format=json"));
  assert.equal(res.status, 403);
});

test("export returns JSON for an authorized analyst", async () => {
  const { GET } = (await import("@/app/api/admin/analytics/export/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/admin/analytics/export?format=json&days=30"));
  assert.equal(res.status, 200);
  const data = (await res.json()) as { overview: unknown; retention: unknown };
  assert.ok("overview" in data);
  assert.ok("retention" in data);
});

test("export returns CSV when format=csv", async () => {
  const { GET } = (await import("@/app/api/admin/analytics/export/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(new Request("http://test/api/admin/analytics/export?format=csv&days=30"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  const text = await res.text();
  assert.match(text, /section,key,label,value,extra/);
  assert.match(text, /funnel,onboarding_complete/);
});

// ---- POST /api/admin/members/[id]/support -------------------------------

test("support requires the support.assist capability", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "revoke_sessions" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 403);
  assert.equal(revokeCalls, 0);
});

test("support revoke_sessions runs the action and audits it", async () => {
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "revoke_sessions" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(revokeCalls, 1);
  assert.equal(auditCalls.at(-1)?.action, "admin.member.revoke_sessions");
});

test("support export returns the assembled data and audits it", async () => {
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "export" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(exportCalls, 1);
  const data = (await res.json()) as { data: unknown };
  assert.ok("data" in data);
  assert.equal(auditCalls.at(-1)?.action, "admin.member.export");
});

test("support repair queues a rebuild and audits it", async () => {
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "repair" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(repairCalls, 1);
  assert.equal(auditCalls.at(-1)?.action, "admin.member.repair");
});

test("support resend_help reports email-not-configured and audits it", async () => {
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "resend_help" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 200);
  assert.equal(resendCalls, 1);
  const data = (await res.json()) as { delivered: boolean; reason: string };
  assert.equal(data.delivered, false);
  assert.equal(data.reason, "email_not_configured");
  assert.equal(auditCalls.at(-1)?.action, "admin.member.resend_help");
});

test("support rejects an unknown action", async () => {
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "explode" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 400);
  assert.equal(revokeCalls, 0);
});

test("support surfaces a lib failure as its status", async () => {
  revokeResult = { ok: false, status: 404, error: "Not found" };
  const { POST } = (await import("@/app/api/admin/members/[id]/support/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/members/u9/support", { action: "revoke_sessions" }),
    { params: Promise.resolve({ id: "u9" }) },
  );
  assert.equal(res.status, 404);
});
