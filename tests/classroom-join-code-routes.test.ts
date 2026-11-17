/**
 * HTTP route tests for classroom join codes (#1309).
 *
 * Covers:
 *   GET    /api/classrooms/[id]/join-code — 401, guard pass-through, null + view
 *   POST   /api/classrooms/[id]/join-code — 401, 403/404/409 guard, 400 body, rotate + in-tx audit
 *   DELETE /api/classrooms/[id]/join-code — 404 without a code, disable + audit, repeat not re-audited
 *   POST   /api/classrooms/join           — 401, 400, per-user + per-IP failure limits,
 *                                           per-reason failures, security events, audits
 *
 * Mocks: @/lib/api-auth, @/lib/tenant-api, @/lib/classroom,
 *        @/lib/security/rate-limit, @/lib/security/events,
 *        @/lib/security/audit — no DB. Real-guard IDOR coverage lives in
 *        tests/classroom-join-code-idor.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors/api-error";
import { type RouteHandler, deleteReq, getReq, jsonPost, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type AuditInput = {
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
};

type JoinedClassroom = {
  ok: true;
  classroomId: string;
  classroomName: string;
  orgId: string;
  alreadyMember: boolean;
  orgMembershipCreated: boolean;
};

const NOW = new Date("2026-11-17T09:00:00.000Z");
const VIEW = { displayCode: "ABCD-2345", status: "active", expiresAt: null, maxUses: null, useCount: 0 };
const JOINED: JoinedClassroom = {
  ok: true,
  classroomId: "class-1",
  classroomName: "Period 3",
  orgId: "org-1",
  alreadyMember: false,
  orgMembershipCreated: true,
};

let authState: AuthState = "ok";
let guardError: ApiError | null = null;
let archived = false;
let currentView: typeof VIEW | null = null;
let rotateCalls: Array<Record<string, unknown>> = [];
let rotatedRow = { code: "ABCD2345", expiresAt: null as Date | null, maxUses: null as number | null };
let disableCalls: string[] = [];
let disableResult: "disabled" | "already_disabled" | "not_found" = "disabled";
let redeemCalls: Array<{ code: string; userId: string }> = [];
let redeemResult: JoinedClassroom | { ok: false; reason: string; classroomId?: string; orgId?: string } = {
  ok: false,
  reason: "not_found",
};
let rateLimitCalls: Array<{ kind: "consume" | "peek"; key: string }> = [];
/** Keys already over budget: both peeking and consuming throw. */
let exhaustedKeys = new Set<string>();
/** Keys with exactly one unit left: peeking passes, consuming throws. */
let lastUnitKeys = new Set<string>();
let rateLimitError: ApiError = new ApiError(429, "Too many requests");
let securityEvents: Array<Record<string, unknown>> = [];
let auditCalls: AuditInput[] = [];

function captureAudit(input: AuditInput): void {
  auditCalls.push({
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  const manageGuard = (active: boolean) => async (_session: unknown, classroomId: string) => {
    if (guardError) throw guardError;
    if (active && archived) throw new ApiError(409, "Classroom is archived");
    return {
      classroom: { id: classroomId, orgId: "org-1", archivedAt: archived ? NOW : null },
      membership: null,
    };
  };
  mock.module("@/lib/tenant-api", {
    namedExports: {
      requireClassroomManageApi: manageGuard(false),
      requireActiveClassroomManageApi: manageGuard(true),
    },
  });

  mock.module("@/lib/classroom", {
    namedExports: {
      getClassroomJoinCodeView: async () => currentView,
      toJoinCodeView: (row: { code: string; maxUses: number | null }) => ({
        ...VIEW,
        displayCode: `${row.code.slice(0, 4)}-${row.code.slice(4)}`,
        maxUses: row.maxUses,
      }),
      rotateClassroomJoinCode: async (input: {
        audit?: (rotated: { joinCode: typeof rotatedRow; replaced: boolean }) => AuditInput;
      }) => {
        const { audit, ...rest } = input;
        rotateCalls.push(rest);
        const rotated = { joinCode: rotatedRow, replaced: currentView !== null };
        if (audit) captureAudit(audit(rotated));
        return rotated;
      },
      disableClassroomJoinCode: async (classroomId: string, options: { audit?: () => AuditInput }) => {
        disableCalls.push(classroomId);
        if (disableResult === "disabled") {
          if (options.audit) captureAudit(options.audit());
          if (currentView) currentView = { ...currentView, status: "disabled" };
        }
        return disableResult;
      },
      redeemClassroomJoinCode: async (input: {
        code: string;
        userId: string;
        audit?: (joined: JoinedClassroom) => AuditInput;
      }) => {
        redeemCalls.push({ code: input.code, userId: input.userId });
        if (redeemResult.ok && !redeemResult.alreadyMember && input.audit) {
          captureAudit(input.audit(redeemResult));
        }
        return redeemResult;
      },
    },
  });

  mock.module("@/lib/security/rate-limit", {
    namedExports: {
      checkRateLimitByKey: async (key: string) => {
        rateLimitCalls.push({ kind: "consume", key });
        if (exhaustedKeys.has(key) || lastUnitKeys.has(key)) throw rateLimitError;
      },
      assertRateLimitAvailableByKey: async (key: string) => {
        rateLimitCalls.push({ kind: "peek", key });
        if (exhaustedKeys.has(key)) throw rateLimitError;
      },
      clientIpKey: () => "ip:203.0.113.10",
    },
  });

  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "auth.unauthorized",
        forbidden: "auth.forbidden",
        rateLimited: "rate_limit.exceeded",
        csrfBlocked: "csrf.blocked",
        adminMutation: "admin.mutation",
        classroomJoinFailed: "classroom.join_code.failed",
      },
      recordSecurityEvent: (input: Record<string, unknown>) => {
        securityEvents.push(input);
        return input;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        securityAdminAccessDenied: "security.admin_access_denied",
        classroomJoinCodeRotated: "classroom.join_code.rotated",
        classroomJoinCodeDisabled: "classroom.join_code.disabled",
        classroomJoinedViaCode: "classroom.joined_via_code",
        classroomJoinCodeFailed: "classroom.join_code.failed",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {},
      recordAuditFromRequest: async (input: AuditInput) => captureAudit(input),
    },
  });
});

beforeEach(() => {
  authState = "ok";
  guardError = null;
  archived = false;
  currentView = null;
  rotateCalls = [];
  rotatedRow = { code: "ABCD2345", expiresAt: null, maxUses: null };
  disableCalls = [];
  disableResult = "disabled";
  redeemCalls = [];
  redeemResult = { ok: false, reason: "not_found" };
  rateLimitCalls = [];
  exhaustedKeys = new Set();
  lastUnitKeys = new Set();
  rateLimitError = new ApiError(429, "Too many requests");
  securityEvents = [];
  auditCalls = [];
});

async function joinCodeRoute() {
  return (await import("@/app/api/classrooms/[id]/join-code/route")) as {
    GET: RouteHandler;
    POST: RouteHandler;
    DELETE: RouteHandler;
  };
}

async function joinRoute() {
  return (await import("@/app/api/classrooms/join/route")) as { POST: RouteHandler };
}

const JOIN_CODE_URL = "http://test/api/classrooms/class-1/join-code";
const JOIN_URL = "http://test/api/classrooms/join";
const USER_KEY = "classroom-join:user:user-1";
const IP_FAILURE_KEY = "classroom-join:failed:ip:203.0.113.10";
const params = withParams({ id: "class-1" });

async function errorMessage(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

function assertNoCodeInTelemetry() {
  const serialized = JSON.stringify([auditCalls, securityEvents]);
  assert.equal(serialized.includes("ABCD"), false, "telemetry must never include the join code");
}

// ---------------------------------------------------------------------------
// /api/classrooms/[id]/join-code
// ---------------------------------------------------------------------------

test("join-code routes require authentication", async () => {
  authState = "unauth";
  const { GET, POST, DELETE } = await joinCodeRoute();
  assert.equal((await GET(getReq(JOIN_CODE_URL), params)).status, 401);
  assert.equal((await POST(jsonPost(JOIN_CODE_URL, { expiresInDays: 7, maxUses: null }), params)).status, 401);
  assert.equal((await DELETE(deleteReq(JOIN_CODE_URL), params)).status, 401);
  assert.equal(rotateCalls.length + disableCalls.length, 0);
});

test("join-code routes surface the manage guard's 403 and 404 before touching the code", async () => {
  const { GET, POST, DELETE } = await joinCodeRoute();
  guardError = new ApiError(403, "Forbidden");
  assert.equal((await GET(getReq(JOIN_CODE_URL), params)).status, 403);
  assert.equal((await POST(jsonPost(JOIN_CODE_URL, { expiresInDays: 7, maxUses: null }), params)).status, 403);
  assert.equal((await DELETE(deleteReq(JOIN_CODE_URL), params)).status, 403);
  guardError = new ApiError(404, "Classroom not found");
  assert.equal((await GET(getReq(JOIN_CODE_URL), params)).status, 404);
  assert.equal(rotateCalls.length + disableCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("GET join-code returns null without a code and the view with one", async () => {
  const { GET } = await joinCodeRoute();
  const empty = await GET(getReq(JOIN_CODE_URL), params);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { joinCode: null });

  currentView = { ...VIEW, useCount: 3 };
  const res = await GET(getReq(JOIN_CODE_URL), params);
  assert.deepEqual(await res.json(), { joinCode: { ...VIEW, useCount: 3 } });
});

test("POST join-code rotates with the requested settings and audits without the code", async () => {
  currentView = VIEW;
  rotatedRow = { code: "ABCD2345", expiresAt: NOW, maxUses: 30 };
  const { POST } = await joinCodeRoute();
  const res = await POST(jsonPost(JOIN_CODE_URL, { expiresInDays: 7, maxUses: 30 }), params);
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { ok: boolean; joinCode: { displayCode: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.joinCode.displayCode, "ABCD-2345");
  assert.deepEqual(rotateCalls, [{ classroomId: "class-1", actorId: "user-1", expiresInDays: 7, maxUses: 30 }]);
  assert.deepEqual(auditCalls, [
    {
      action: "classroom.join_code.rotated",
      targetType: "classroom",
      targetId: "class-1",
      metadata: { orgId: "org-1", replaced: true, expires: true, maxUses: 30 },
    },
  ]);
  assertNoCodeInTelemetry();
});

test("POST join-code accepts null settings and rejects out-of-range values", async () => {
  const { POST } = await joinCodeRoute();
  const res = await POST(jsonPost(JOIN_CODE_URL, { expiresInDays: null, maxUses: null }), params);
  assert.equal(res.status, 200);
  assert.deepEqual(rotateCalls[0], { classroomId: "class-1", actorId: "user-1", expiresInDays: null, maxUses: null });
  assert.deepEqual(auditCalls[0]?.metadata, { orgId: "org-1", replaced: false, expires: false, maxUses: null });

  for (const body of [
    { expiresInDays: 0, maxUses: null },
    { expiresInDays: 366, maxUses: null },
    { expiresInDays: 7, maxUses: 0 },
    { expiresInDays: 7, maxUses: 1001 },
    { expiresInDays: 1.5, maxUses: null },
  ]) {
    const rejected = await POST(jsonPost(JOIN_CODE_URL, body), params);
    assert.equal(rejected.status, 400, JSON.stringify(body));
  }
  assert.equal(rotateCalls.length, 1);
});

test("POST join-code refuses archived classrooms", async () => {
  archived = true;
  const { POST } = await joinCodeRoute();
  const res = await POST(jsonPost(JOIN_CODE_URL, { expiresInDays: 7, maxUses: null }), params);
  assert.equal(res.status, 409);
  assert.equal(rotateCalls.length, 0);
});

test("DELETE join-code disables the code (archived classrooms included) and audits once", async () => {
  archived = true;
  currentView = VIEW;
  const { DELETE } = await joinCodeRoute();
  const res = await DELETE(deleteReq(JOIN_CODE_URL), params);
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { joinCode: { status: string } };
  assert.equal(payload.joinCode.status, "disabled");
  assert.deepEqual(disableCalls, ["class-1"]);
  assert.deepEqual(auditCalls, [
    {
      action: "classroom.join_code.disabled",
      targetType: "classroom",
      targetId: "class-1",
      metadata: { orgId: "org-1" },
    },
  ]);

  disableResult = "already_disabled";
  const repeat = await DELETE(deleteReq(JOIN_CODE_URL), params);
  assert.equal(repeat.status, 200);
  assert.equal(auditCalls.length, 1, "a repeated disable is not audited again");
});

test("DELETE join-code returns 404 when the classroom has no code", async () => {
  disableResult = "not_found";
  const { DELETE } = await joinCodeRoute();
  const res = await DELETE(deleteReq(JOIN_CODE_URL), params);
  assert.equal(res.status, 404);
  assert.equal(await errorMessage(res), "Classroom has no join code");
  assert.equal(auditCalls.length, 0);
});

// ---------------------------------------------------------------------------
// /api/classrooms/join
// ---------------------------------------------------------------------------

test("join requires authentication and a bounded code", async () => {
  const { POST } = await joinRoute();
  authState = "unauth";
  assert.equal((await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }))).status, 401);
  authState = "ok";
  assert.equal((await POST(jsonPost(JOIN_URL, { code: "" }))).status, 400);
  assert.equal((await POST(jsonPost(JOIN_URL, { code: "X".repeat(17) }))).status, 400);
  assert.equal(redeemCalls.length, 0);
});

test("successful joins charge the user budget but never the per-IP failure budget", async () => {
  redeemResult = JOINED;
  const { POST } = await joinRoute();
  const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
  assert.equal(res.status, 200);
  assert.deepEqual(rateLimitCalls, [
    { kind: "consume", key: USER_KEY },
    { kind: "peek", key: IP_FAILURE_KEY },
  ]);
  assert.equal(securityEvents.length, 0);
});

test("an exhausted user or IP failure budget is refused before redeeming, without audit rows", async () => {
  const { POST } = await joinRoute();
  for (const key of [USER_KEY, IP_FAILURE_KEY]) {
    exhaustedKeys = new Set([key]);
    redeemCalls = [];
    const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
    assert.equal(res.status, 429);
    assert.equal(redeemCalls.length, 0);
    assert.equal(auditCalls.length, 0, "429s are recorded as security events by the api-handler, not audit rows");
  }
});

test("limiter outages propagate", async () => {
  const { POST } = await joinRoute();
  exhaustedKeys = new Set([USER_KEY]);
  rateLimitError = new ApiError(503, "Rate limiter unavailable");
  assert.equal((await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }))).status, 503);

  exhaustedKeys = new Set();
  lastUnitKeys = new Set([IP_FAILURE_KEY]);
  assert.equal((await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }))).status, 503);
});

test("each failure reason maps to its status and message, with a security event and audit row", async () => {
  const { POST } = await joinRoute();
  const invalid = "That class code isn't valid. Check it with your teacher.";
  const cases: Array<{ reason: string; status: number; message: string; scoped: boolean }> = [
    { reason: "invalid_format", status: 400, message: "Class codes are 8 letters and numbers, like ABCD-2345.", scoped: false },
    { reason: "not_found", status: 404, message: invalid, scoped: false },
    { reason: "disabled", status: 404, message: invalid, scoped: true },
    { reason: "expired", status: 410, message: "That class code has expired. Ask your teacher for a new one.", scoped: true },
    { reason: "exhausted", status: 409, message: "That class is full. Ask your teacher for a new code.", scoped: true },
    { reason: "archived", status: 409, message: "That class is no longer active.", scoped: true },
  ];
  for (const failure of cases) {
    redeemResult = failure.scoped
      ? { ok: false, reason: failure.reason, classroomId: "class-1", orgId: "org-1" }
      : { ok: false, reason: failure.reason };
    auditCalls = [];
    securityEvents = [];
    rateLimitCalls = [];
    const res = await POST(jsonPost(JOIN_URL, { code: "abcd-2345" }));
    assert.equal(res.status, failure.status, failure.reason);
    assert.equal(await errorMessage(res), failure.message);
    assert.deepEqual(rateLimitCalls.at(-1), { kind: "consume", key: IP_FAILURE_KEY }, "failures charge the IP");
    assert.deepEqual(securityEvents, [
      {
        type: "classroom.join_code.failed",
        severity: "low",
        route: "/api/classrooms/join",
        status: failure.status,
        actorId: "user-1",
        ip: null,
        meta: { reason: failure.reason },
      },
    ]);
    assert.deepEqual(auditCalls, [
      {
        action: "classroom.join_code.failed",
        targetType: "classroom",
        targetId: failure.scoped ? "class-1" : null,
        metadata: failure.scoped ? { reason: failure.reason, orgId: "org-1" } : { reason: failure.reason },
      },
    ]);
    assertNoCodeInTelemetry();
  }
  assert.deepEqual(redeemCalls[0], { code: "abcd-2345", userId: "user-1" });
});

test("the failure that uses up the IP budget still gets its own failure response", async () => {
  lastUnitKeys = new Set([IP_FAILURE_KEY]);
  const { POST } = await joinRoute();
  const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
  assert.equal(res.status, 404);
  assert.equal(auditCalls.length, 1);
  assert.equal(securityEvents.length, 1);
});

test("contention is reported as retryable and does not charge the IP failure budget", async () => {
  redeemResult = { ok: false, reason: "contention" };
  const { POST } = await joinRoute();
  const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
  assert.equal(res.status, 409);
  assert.equal(await errorMessage(res), "Lots of students are joining right now. Try again in a moment.");
  assert.equal(rateLimitCalls.some((call) => call.kind === "consume" && call.key === IP_FAILURE_KEY), false);
});

test("join enrolls the learner and audits the new enrollment", async () => {
  redeemResult = JOINED;
  const { POST } = await joinRoute();
  const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    alreadyMember: false,
    classroom: { id: "class-1", name: "Period 3" },
  });
  assert.deepEqual(auditCalls, [
    {
      action: "classroom.joined_via_code",
      targetType: "classroom",
      targetId: "class-1",
      metadata: { orgId: "org-1", orgMembershipCreated: true },
    },
  ]);
  assertNoCodeInTelemetry();
});

test("joining a classroom you already belong to succeeds without an audit entry", async () => {
  redeemResult = { ...JOINED, alreadyMember: true, orgMembershipCreated: false };
  const { POST } = await joinRoute();
  const res = await POST(jsonPost(JOIN_URL, { code: "ABCD-2345" }));
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { alreadyMember: boolean };
  assert.equal(payload.alreadyMember, true);
  assert.equal(auditCalls.length, 0);
});
