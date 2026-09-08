process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

let viewerRole: "teacher" | "orgAdmin" = "orgAdmin";
let analyticsCalls = 0;

before(() => {
  mock.module("@/lib/classroom/queries", {
    namedExports: {
      getClassroom: async () => ({
        id: "class-1",
        orgId: "org-1",
        teacherId: "teacher-1",
      }),
    },
  });
  mock.module("@/lib/org/queries", {
    namedExports: {
      getMembership: async () => ({ role: "OrgAdmin" }),
    },
  });
  mock.module("@/lib/org/guards", {
    namedExports: {
      hasOrgCapability: () => true,
      isSystemAdmin: () => false,
    },
  });
  mock.module("@/lib/rbac", {
    namedExports: {
      CAPABILITIES: { orgManage: "org.manage" },
    },
  });
  mock.module("@/lib/analytics/tenant", {
    namedExports: {
      viewerRoleForClassroom: () => viewerRole,
      getClassroomAnalytics: async () => {
        analyticsCalls += 1;
        return { redacted: viewerRole === "orgAdmin" };
      },
    },
  });
});

beforeEach(() => {
  viewerRole = "orgAdmin";
  analyticsCalls = 0;
});

test("aggregate-only viewers cannot narrow analytics to one assignment", async () => {
  const { getScopedClassroomAnalytics } = await import(
    "@/lib/analytics/classroom-access"
  );

  await assert.rejects(
    getScopedClassroomAnalytics({
      classroomId: "class-1",
      viewer: { id: "org-admin", role: "Reader" },
      filters: { assignmentId: "targeted-assignment" },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      error.status === 403,
  );
  assert.equal(analyticsCalls, 0);
});

test("teachers retain assignment-level analytics filtering", async () => {
  viewerRole = "teacher";
  const { getScopedClassroomAnalytics } = await import(
    "@/lib/analytics/classroom-access"
  );

  await getScopedClassroomAnalytics({
    classroomId: "class-1",
    viewer: { id: "teacher-1", role: "Reader" },
    filters: { assignmentId: "assignment-1" },
  });

  assert.equal(analyticsCalls, 1);
});
