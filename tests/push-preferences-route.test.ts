/**
 * Route tests for GET/PUT /api/push/preferences (issue #1001 batch 1).
 *
 * Covers: auth, GET returns current preference, PUT validates body,
 * PUT upserts preference, error on invalid input.
 *
 * Mocks: @/lib/api-auth, @/lib/reminder-preferences, @/lib/push/schemas,
 *        @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, getReq, jsonPut } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type Preference = {
  enabled: boolean;
  preferredHour: number | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
};
let currentPreference: Preference = {
  enabled: true,
  preferredHour: null,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: null,
};
let upsertCallArgs: { userId: string; update: Record<string, unknown> } | null = null;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/reminder-preferences", {
    namedExports: {
      getReminderPreference: async (userId: string) => {
        return { ...currentPreference, _userId: userId };
      },
      upsertReminderPreference: async (userId: string, update: Record<string, unknown>) => {
        upsertCallArgs = { userId, update };
        return { ...currentPreference, ...update };
      },
      validateReminderPreference: (body: Record<string, unknown>) => {
        // Minimal validation matching real implementation
        if ("enabled" in body && typeof body.enabled !== "boolean") {
          return { ok: false, error: "enabled must be a boolean" };
        }
        if ("preferredHour" in body && body.preferredHour !== null) {
          const h = body.preferredHour;
          if (typeof h !== "number" || h < 0 || h > 23 || !Number.isInteger(h)) {
            return { ok: false, error: "preferredHour must be an integer 0–23 or null" };
          }
        }
        return { ok: true, value: body };
      },
    },
  });

  mock.module("@/lib/push/schemas", {
    namedExports: {
      rawObjectBody: (value: unknown) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return { ok: false, error: "body must be an object" };
        }
        return { ok: true, value };
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: { securityAdminAccessDenied: "security.admin_access_denied" },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async () => {},
      tryRecordAuditLog: async () => {},
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
  currentPreference = {
    enabled: true,
    preferredHour: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
  };
  upsertCallArgs = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREF_URL = "http://test/api/push/preferences";

async function loadGet(): Promise<RouteHandler> {
  const { GET } = (await import("@/app/api/push/preferences/route")) as { GET: RouteHandler };
  return GET;
}

async function loadPut(): Promise<RouteHandler> {
  const { PUT } = (await import("@/app/api/push/preferences/route")) as { PUT: RouteHandler };
  return PUT;
}

// ---------------------------------------------------------------------------
// GET /api/push/preferences
// ---------------------------------------------------------------------------

test("GET /push/preferences returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadGet();
  const res = await handler(getReq(PREF_URL));
  assert.equal(res.status, 401);
});

test("GET /push/preferences returns current preference", async () => {
  currentPreference = { enabled: false, preferredHour: 9, quietHoursStart: 22, quietHoursEnd: 7, timezone: "US/Eastern" };
  const handler = await loadGet();
  const res = await handler(getReq(PREF_URL));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.preference.enabled, false);
  assert.equal(json.preference.preferredHour, 9);
  assert.equal(json.preference.timezone, "US/Eastern");
});

// ---------------------------------------------------------------------------
// PUT /api/push/preferences
// ---------------------------------------------------------------------------

test("PUT /push/preferences returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadPut();
  const res = await handler(jsonPut(PREF_URL, { enabled: false }));
  assert.equal(res.status, 401);
});

test("PUT /push/preferences returns 400 for invalid preferredHour", async () => {
  const handler = await loadPut();
  const res = await handler(jsonPut(PREF_URL, { preferredHour: 25 }));
  assert.equal(res.status, 400);
});

test("PUT /push/preferences returns 400 for non-boolean enabled", async () => {
  const handler = await loadPut();
  const res = await handler(jsonPut(PREF_URL, { enabled: "yes" }));
  assert.equal(res.status, 400);
});

test("PUT /push/preferences upserts valid preference for user", async () => {
  const handler = await loadPut();
  const res = await handler(jsonPut(PREF_URL, { enabled: false, preferredHour: 8 }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.preference.enabled, false);
  assert.equal(upsertCallArgs?.userId, "user-1");
  assert.deepEqual(upsertCallArgs?.update, { enabled: false, preferredHour: 8 });
});

test("PUT /push/preferences accepts null preferredHour", async () => {
  const handler = await loadPut();
  const res = await handler(jsonPut(PREF_URL, { preferredHour: null }));
  assert.equal(res.status, 200);
  assert.equal(upsertCallArgs?.update.preferredHour, null);
});
