process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { CAPABILITIES, type Capability } from "@/lib/rbac";
import { adminSession, getReq, readerSession, readJson, type RouteHandler } from "./support/route";

type AuthState = "ok" | "unauth" | "forbidden";

let authState: AuthState = "ok";
let capturedCapabilities: Capability[] = [];
let deniedAuditCalls = 0;
const handlerCalls = {
  jobs: 0,
  tags: 0,
  analytics: 0,
  security: 0,
};

function authError(message: "Unauthorized" | "Forbidden", status: 401 | 403) {
  return { error: NextResponse.json({ error: message }, { status }) };
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => authState === "unauth"
        ? authError("Unauthorized", 401)
        : { session: readerSession },
      requireCapabilityApi: async (capability: Capability) => {
        capturedCapabilities.push(capability);
        if (authState === "unauth") return authError("Unauthorized", 401);
        if (authState === "forbidden") {
          return {
            session: readerSession,
            error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
          };
        }
        return { session: adminSession };
      },
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: { securityAdminAccessDenied: "security.admin_access_denied" },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {
        deniedAuditCalls++;
      },
    },
  });
  mock.module("@/lib/admin/jobs", {
    namedExports: {
      listAdminJobs: async () => {
        handlerCalls.jobs++;
        return { jobs: [], total: 0, page: 1, totalPages: 1 };
      },
      getJobDashboard: async () => ({ byStatus: {}, byType: {}, stuck: [] }),
    },
  });
  mock.module("@/lib/article-library/admin-tags", {
    namedExports: {
      listAdminTagMergeTargets: async () => {
        handlerCalls.tags++;
        return [];
      },
    },
  });
  mock.module("@/lib/analytics/admin", {
    namedExports: {
      getAdminAnalytics: async () => {
        handlerCalls.analytics++;
        return { totals: {} };
      },
    },
  });
  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "api.unauthorized",
        forbidden: "api.forbidden",
        rateLimited: "api.rate_limited",
        csrfBlocked: "api.csrf_blocked",
        adminMutation: "api.admin_mutation",
      },
      recordSecurityEvent: () => undefined,
      getRecentSecurityEvents: () => {
        handlerCalls.security++;
        return [];
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  capturedCapabilities = [];
  deniedAuditCalls = 0;
  handlerCalls.jobs = 0;
  handlerCalls.tags = 0;
  handlerCalls.analytics = 0;
  handlerCalls.security = 0;
});

const cases: Array<{
  name: string;
  module: string;
  url: string;
  capability: Capability;
  callKey: keyof typeof handlerCalls;
}> = [
  {
    name: "jobs admin API",
    module: "@/app/api/admin/jobs/route",
    url: "http://test/api/admin/jobs",
    capability: CAPABILITIES.jobsManage,
    callKey: "jobs",
  },
  {
    name: "tags admin API",
    module: "@/app/api/admin/tags/route",
    url: "http://test/api/admin/tags",
    capability: CAPABILITIES.tagsManage,
    callKey: "tags",
  },
  {
    name: "analytics admin API",
    module: "@/app/api/admin/analytics/route",
    url: "http://test/api/admin/analytics",
    capability: CAPABILITIES.analyticsView,
    callKey: "analytics",
  },
  {
    name: "security events admin API",
    module: "@/app/api/admin/security/events/route",
    url: "http://test/api/admin/security/events",
    capability: CAPABILITIES.securityView,
    callKey: "security",
  },
];

for (const c of cases) {
  test(`${c.name} allows callers with the domain capability`, async () => {
    authState = "ok";
    const { GET } = (await import(c.module)) as { GET: RouteHandler };

    const res = await GET(getReq(c.url), undefined);

    assert.equal(res.status, 200);
    assert.equal(capturedCapabilities.at(-1), c.capability);
    assert.equal(handlerCalls[c.callKey], 1);
  });

  test(`${c.name} denies callers missing the domain capability`, async () => {
    authState = "forbidden";
    const { GET } = (await import(c.module)) as { GET: RouteHandler };

    const res = await GET(getReq(c.url), undefined);
    const body = await readJson<{ error: string }>(res);

    assert.equal(res.status, 403);
    assert.equal(body.error, "Forbidden");
    assert.equal(capturedCapabilities.at(-1), c.capability);
    assert.equal(handlerCalls[c.callKey], 0);
    assert.equal(deniedAuditCalls, 1);
  });
}
