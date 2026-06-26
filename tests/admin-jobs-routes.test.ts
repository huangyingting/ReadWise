/**
 * Route tests for the admin jobs API (RW-017 / RW-018).
 *
 * Verifies admin authorization is enforced (a non-admin gets 403 and the action
 * is never run) and that the happy paths invoke the underlying lib + record an
 * audit entry. `@/lib/api-auth`, `@/lib/audit`, `@/lib/admin-jobs` and
 * `@/lib/backfill` are mocked — no DB, no real auth.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let auditCalls: { action: string }[] = [];

let listCalls = 0;
let actionCalls: { id: string; action: string }[] = [];
let backfillCalls: unknown[] = [];

let actionResult:
  | { ok: true; job: { id: string; status: string; type: string }; previousStatus: string; action: string }
  | { ok: false; status: number; error: string } = {
  ok: true,
  job: { id: "job-1", status: "PENDING", type: "ARTICLE_PROCESS" },
  previousStatus: "FAILED",
  action: "retry",
};

let backfillThrows = false;

const AUDIT_ACTIONS = {
  adminJobRetry: "admin.job.retry",
  adminJobCancel: "admin.job.cancel",
  adminJobArchive: "admin.job.archive",
  adminJobBackfill: "admin.job.backfill",
  securityAdminAccessDenied: "security.admin_access_denied",
};

class BackfillError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BackfillError";
    this.status = status;
  }
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/security/audit", {
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

  mock.module("@/lib/admin/jobs", {
    namedExports: {
      JOB_ACTIONS: ["retry", "cancel", "archive"],
      listAdminJobs: async () => {
        listCalls++;
        return { jobs: [], total: 0, page: 1, pageSize: 25, totalPages: 1 };
      },
      getJobDashboard: async () => ({
        byStatus: {},
        byType: {},
        total: 0,
        stuck: 0,
        recentFailures: [],
        deadLetter: [],
      }),
      runJobAction: async (id: string, action: string) => {
        actionCalls.push({ id, action });
        return actionResult;
      },
    },
  });

  mock.module("@/lib/processing/backfill", {
    namedExports: {
      BACKFILL_FEATURES: [
        "difficulty",
        "tags",
        "vocabulary",
        "quiz",
        "translation",
        "speech",
        "grammar",
      ],
      BackfillError,
      runBackfill: async (opts: unknown) => {
        backfillCalls.push(opts);
        if (backfillThrows) throw new BackfillError("bad request", 400);
        return {
          dryRun: false,
          mode: "missing",
          features: ["tags"],
          reason: "x",
          scanned: 1,
          matched: 1,
          cap: 50,
          enqueued: 1,
          skippedExisting: 0,
          cleared: 0,
          jobIds: ["job-1"],
          plan: [],
        };
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  listCalls = 0;
  actionCalls = [];
  backfillCalls = [];
  backfillThrows = false;
  actionResult = {
    ok: true,
    job: { id: "job-1", status: "PENDING", type: "ARTICLE_PROCESS" },
    previousStatus: "FAILED",
    action: "retry",
  };
});

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- GET /api/admin/jobs -------------------------------------------------

test("GET /api/admin/jobs requires admin", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/jobs/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/jobs"));
  assert.equal(res.status, 403);
  assert.equal(listCalls, 0);
});

test("GET /api/admin/jobs lists jobs for an admin", async () => {
  const { GET } = (await import("@/app/api/admin/jobs/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/jobs?status=FAILED"));
  assert.equal(res.status, 200);
  assert.equal(listCalls, 1);
  const data = (await res.json()) as { dashboard: unknown };
  assert.ok("dashboard" in data);
});

// ---- POST /api/admin/jobs/[id] -------------------------------------------

test("POST /api/admin/jobs/[id] requires admin", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/jobs/[id]/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("http://test/api/admin/jobs/job-1", { action: "retry" }), {
    params: Promise.resolve({ id: "job-1" }),
  });
  assert.equal(res.status, 403);
  assert.equal(actionCalls.length, 0);
});

test("POST /api/admin/jobs/[id] runs the action and audits it", async () => {
  const { POST } = (await import("@/app/api/admin/jobs/[id]/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("http://test/api/admin/jobs/job-1", { action: "retry" }), {
    params: Promise.resolve({ id: "job-1" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(actionCalls, [{ id: "job-1", action: "retry" }]);
  assert.equal(auditCalls.at(-1)?.action, "admin.job.retry");
});

test("POST /api/admin/jobs/[id] surfaces a guard failure as its status", async () => {
  actionResult = { ok: false, status: 409, error: "Cannot retry a PENDING job" };
  const { POST } = (await import("@/app/api/admin/jobs/[id]/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("http://test/api/admin/jobs/job-1", { action: "retry" }), {
    params: Promise.resolve({ id: "job-1" }),
  });
  assert.equal(res.status, 409);
});

test("POST /api/admin/jobs/[id] rejects an unknown action", async () => {
  const { POST } = (await import("@/app/api/admin/jobs/[id]/route")) as { POST: RouteHandler };
  const res = await POST(jsonReq("http://test/api/admin/jobs/job-1", { action: "explode" }), {
    params: Promise.resolve({ id: "job-1" }),
  });
  assert.equal(res.status, 400);
  assert.equal(actionCalls.length, 0);
});

// ---- POST /api/admin/jobs/backfill ---------------------------------------

test("POST /api/admin/jobs/backfill requires admin", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/jobs/backfill/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonReq("http://test/api/admin/jobs/backfill", { features: ["tags"], reason: "x" }),
  );
  assert.equal(res.status, 403);
  assert.equal(backfillCalls.length, 0);
});

test("POST /api/admin/jobs/backfill runs the backfill with the operator id and audits", async () => {
  const { POST } = (await import("@/app/api/admin/jobs/backfill/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonReq("http://test/api/admin/jobs/backfill", {
      features: ["tags"],
      reason: "new prompts",
      dryRun: false,
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(backfillCalls.length, 1);
  const opts = backfillCalls[0] as { operatorId: string; reason: string };
  assert.equal(opts.operatorId, "admin-1");
  assert.equal(opts.reason, "new prompts");
  assert.equal(auditCalls.at(-1)?.action, "admin.job.backfill");
});

test("POST /api/admin/jobs/backfill maps a BackfillError to its status", async () => {
  backfillThrows = true;
  const { POST } = (await import("@/app/api/admin/jobs/backfill/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonReq("http://test/api/admin/jobs/backfill", { features: ["tags"], reason: "x" }),
  );
  assert.equal(res.status, 400);
});

test("POST /api/admin/jobs/backfill rejects a missing reason at validation", async () => {
  const { POST } = (await import("@/app/api/admin/jobs/backfill/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonReq("http://test/api/admin/jobs/backfill", { features: ["tags"] }),
  );
  assert.equal(res.status, 400);
  assert.equal(backfillCalls.length, 0);
});
