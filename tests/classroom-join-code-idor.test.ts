/**
 * IDOR boundaries for the classroom join-code routes (#1309).
 *
 * Runs the REAL `@/lib/tenant-api` guards and classroom/org authorization
 * against mocked membership/classroom lookups, so cross-org and same-org
 * non-owner callers are proven unable to read, rotate, or disable another
 * classroom's join code — and the join-code commands are never reached.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, deleteReq, getReq, jsonPost, withParams } from "./support/route";

type SessionUser = { id: string; role: string; name: string; email: string | null };

const CLASSROOMS = new Map([
  ["class-b", { id: "class-b", orgId: "org-b", name: "B", teacherId: "teacher-b", archivedAt: null }],
]);
const MEMBERSHIPS = new Map<string, string>([
  ["teacher-a:org-a", "Teacher"],
  ["admin-a:org-a", "OrgAdmin"],
  ["teacher-b:org-b", "Teacher"],
  ["colleague-b:org-b", "Teacher"],
  ["student-b:org-b", "Student"],
  ["admin-b:org-b", "OrgAdmin"],
]);

let sessionUser: SessionUser = { id: "teacher-a", role: "Reader", name: "T", email: null };
let commandCalls: string[] = [];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session: { user: sessionUser } }),
    },
  });
  mock.module("@/lib/session", {
    namedExports: { requireSession: async () => ({ user: sessionUser }) },
  });
  mock.module("@/lib/org/queries", {
    namedExports: {
      getMembership: async (userId: string, orgId: string) => {
        const role = MEMBERSHIPS.get(`${userId}:${orgId}`);
        return role ? { id: `${userId}:${orgId}`, userId, orgId, role } : null;
      },
    },
  });
  mock.module("@/lib/classroom/queries", {
    namedExports: { getClassroom: async (id: string) => CLASSROOMS.get(id) ?? null },
  });
  mock.module("@/lib/classroom", {
    namedExports: {
      getClassroomJoinCodeView: async () => {
        commandCalls.push("view");
        return null;
      },
      toJoinCodeView: () => ({ displayCode: "ABCD-2345", status: "active" }),
      rotateClassroomJoinCode: async () => {
        commandCalls.push("rotate");
        return { joinCode: { code: "ABCD2345", expiresAt: null, maxUses: null }, replaced: false };
      },
      disableClassroomJoinCode: async () => {
        commandCalls.push("disable");
        return "disabled";
      },
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        securityAdminAccessDenied: "security.admin_access_denied",
        classroomJoinCodeRotated: "classroom.join_code.rotated",
        classroomJoinCodeDisabled: "classroom.join_code.disabled",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {},
      recordAuditFromRequest: async () => {},
    },
  });
});

beforeEach(() => {
  commandCalls = [];
});

async function callAll(classroomId: string): Promise<number[]> {
  const route = (await import("@/app/api/classrooms/[id]/join-code/route")) as {
    GET: RouteHandler;
    POST: RouteHandler;
    DELETE: RouteHandler;
  };
  const url = `http://test/api/classrooms/${classroomId}/join-code`;
  const params = () => withParams({ id: classroomId });
  return [
    (await route.GET(getReq(url), params())).status,
    (await route.POST(jsonPost(url, { expiresInDays: 7, maxUses: null }), params())).status,
    (await route.DELETE(deleteReq(url), params())).status,
  ];
}

function as(id: string, role = "Reader") {
  sessionUser = { id, role, name: id, email: null };
}

test("teachers and admins of another org cannot touch the classroom's join code", async () => {
  for (const id of ["teacher-a", "admin-a"]) {
    as(id);
    assert.deepEqual(await callAll("class-b"), [403, 403, 403], id);
  }
  assert.deepEqual(commandCalls, []);
});

test("same-org non-owners (another teacher, a student) are refused", async () => {
  for (const id of ["colleague-b", "student-b"]) {
    as(id);
    assert.deepEqual(await callAll("class-b"), [403, 403, 403], id);
  }
  assert.deepEqual(commandCalls, []);
});

test("a former teacher without a current org membership is refused", async () => {
  as("teacher-b-removed");
  CLASSROOMS.set("class-orphan", {
    id: "class-orphan",
    orgId: "org-b",
    name: "Orphan",
    teacherId: "teacher-b-removed",
    archivedAt: null,
  });
  assert.deepEqual(await callAll("class-orphan"), [403, 403, 403]);
  assert.deepEqual(commandCalls, []);
});

test("an unknown classroom is a 404 for everyone", async () => {
  as("admin-b");
  assert.deepEqual(await callAll("class-missing"), [404, 404, 404]);
  assert.deepEqual(commandCalls, []);
});

test("the classroom's teacher, its org admin, and a system admin are allowed", async () => {
  for (const [id, role] of [
    ["teacher-b", "Reader"],
    ["admin-b", "Reader"],
    ["platform-admin", "Admin"],
  ] as const) {
    as(id, role);
    commandCalls = [];
    assert.deepEqual(await callAll("class-b"), [200, 200, 200], id);
    assert.deepEqual(commandCalls, ["view", "rotate", "disable", "view"], id);
  }
});
