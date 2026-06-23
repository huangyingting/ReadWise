/**
 * Tenant analytics & privacy tests (RW-063).
 *
 * Exercises the PURE access model, aggregation and redaction in
 * `@/lib/tenant-analytics`. `@/lib/org` and `@/lib/classroom` are mocked to the
 * minimum the module imports (so the heavy prisma/auth chain isn't loaded); the
 * functions under test take plain data and return plain data.
 */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { AssignmentStatus } from "@prisma/client";

type TA = typeof import("@/lib/tenant-analytics");
let ta: TA;

before(async () => {
  mock.module("@/lib/org", {
    namedExports: {
      isSystemAdmin: (role: string | null | undefined) =>
        role === "Admin" || role === "System",
    },
  });
  mock.module("@/lib/classroom", {
    namedExports: {
      getClassroomProgressData: async () => null,
    },
  });
  ta = await import("@/lib/tenant-analytics");
});

function sampleData(): import("@/lib/classroom").ClassroomProgressData {
  return {
    classroom: { id: "c1", name: "Class 1", orgId: "o1", teacherId: "t1" },
    students: [
      { userId: "s1", name: "Sam", email: "s1@example.com" },
      { userId: "s2", name: "Sky", email: "s2@example.com" },
    ],
    assignments: [
      { id: "a1", articleId: "art1", articleTitle: "Article 1", dueDate: null, createdAt: new Date() },
      { id: "a2", articleId: "art2", articleTitle: "Article 2", dueDate: null, createdAt: new Date() },
    ],
    completions: [
      { assignmentId: "a1", studentId: "s1", status: AssignmentStatus.COMPLETED, quizScore: 80, completedAt: new Date() },
      { assignmentId: "a2", studentId: "s1", status: AssignmentStatus.IN_PROGRESS, quizScore: null, completedAt: null },
      { assignmentId: "a1", studentId: "s2", status: AssignmentStatus.COMPLETED, quizScore: 100, completedAt: new Date() },
      // A completion from a student NOT on the roster — must be ignored.
      { assignmentId: "a1", studentId: "ghost", status: AssignmentStatus.COMPLETED, quizScore: 10, completedAt: new Date() },
    ],
  };
}

// ---------------------------------------------------------------------------
// Access model
// ---------------------------------------------------------------------------

test("analyticsAccessFor maps each role to its visibility envelope", () => {
  assert.deepEqual(ta.analyticsAccessFor("learner"), { scope: "self", individualData: false });
  assert.deepEqual(ta.analyticsAccessFor("teacher"), { scope: "classroom", individualData: true });
  assert.deepEqual(ta.analyticsAccessFor("orgAdmin"), { scope: "org", individualData: false });
  assert.deepEqual(ta.analyticsAccessFor("systemAdmin"), { scope: "global", individualData: true });
});

test("learnerDataAccess: a learner sees only their own data", () => {
  const self = ta.learnerDataAccess({
    viewerRole: "learner",
    sameUser: true,
    targetInViewerClassroom: false,
    targetInViewerOrg: true,
  });
  assert.deepEqual(self, { allowed: true, individual: true });

  const other = ta.learnerDataAccess({
    viewerRole: "learner",
    sameUser: false,
    targetInViewerClassroom: true,
    targetInViewerOrg: true,
  });
  assert.deepEqual(other, { allowed: false, individual: false });
});

test("learnerDataAccess: a teacher sees individuals only in their classroom", () => {
  const inClass = ta.learnerDataAccess({
    viewerRole: "teacher",
    sameUser: false,
    targetInViewerClassroom: true,
    targetInViewerOrg: true,
  });
  assert.deepEqual(inClass, { allowed: true, individual: true });

  const otherClass = ta.learnerDataAccess({
    viewerRole: "teacher",
    sameUser: false,
    targetInViewerClassroom: false,
    targetInViewerOrg: true,
  });
  assert.deepEqual(otherClass, { allowed: false, individual: false });
});

test("learnerDataAccess: an org admin is org-scoped and aggregate-only", () => {
  const inOrg = ta.learnerDataAccess({
    viewerRole: "orgAdmin",
    sameUser: false,
    targetInViewerClassroom: true,
    targetInViewerOrg: true,
  });
  assert.deepEqual(inOrg, { allowed: true, individual: false });

  const outOfOrg = ta.learnerDataAccess({
    viewerRole: "orgAdmin",
    sameUser: false,
    targetInViewerClassroom: false,
    targetInViewerOrg: false,
  });
  assert.deepEqual(outOfOrg, { allowed: false, individual: false });
});

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

test("aggregateClassroom computes class/assignment/student numbers", () => {
  const out = ta.aggregateClassroom(sampleData());
  assert.equal(out.studentCount, 2);
  assert.equal(out.assignmentCount, 2);
  assert.equal(out.totalExpected, 4);
  assert.equal(out.totalCompleted, 2);
  assert.equal(out.completionRate, 50);
  assert.equal(out.averageQuizScore, 90);
  assert.equal(out.redacted, false);

  const a1 = out.perAssignment.find((a) => a.assignmentId === "a1")!;
  assert.equal(a1.completed, 2);
  assert.equal(a1.inProgress, 0);
  assert.equal(a1.notStarted, 0);
  assert.equal(a1.completionRate, 100);
  assert.equal(a1.averageQuizScore, 90);

  const a2 = out.perAssignment.find((a) => a.assignmentId === "a2")!;
  assert.equal(a2.completed, 0);
  assert.equal(a2.inProgress, 1);
  assert.equal(a2.notStarted, 1);
  assert.equal(a2.completionRate, 0);
  assert.equal(a2.averageQuizScore, null);
});

test("aggregateClassroom ignores completions from non-enrolled students", () => {
  const out = ta.aggregateClassroom(sampleData());
  // "ghost" completed a1; if counted, a1.completed would be 3 (> studentCount).
  const a1 = out.perAssignment.find((a) => a.assignmentId === "a1")!;
  assert.equal(a1.completed, 2);
  assert.ok(!out.perStudent.some((s) => s.studentId === "ghost"));
});

test("aggregateClassroom is pure (same input ⇒ identical output)", () => {
  const a = ta.aggregateClassroom(sampleData());
  const b = ta.aggregateClassroom(sampleData());
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

test("applyAnalyticsAccess redacts individual rows for aggregate-only roles", () => {
  const full = ta.aggregateClassroom(sampleData());

  const teacherView = ta.applyAnalyticsAccess(full, ta.analyticsAccessFor("teacher"));
  assert.equal(teacherView.redacted, false);
  assert.equal(teacherView.perStudent.length, 2);

  const orgView = ta.applyAnalyticsAccess(full, ta.analyticsAccessFor("orgAdmin"));
  assert.equal(orgView.redacted, true);
  assert.equal(orgView.perStudent.length, 0);
  // Class- and assignment-level aggregates survive redaction.
  assert.equal(orgView.completionRate, 50);
  assert.equal(orgView.perAssignment.length, 2);
});

test("redactIndividualData strips named learner rows", () => {
  const full = ta.aggregateClassroom(sampleData());
  const redacted = ta.redactIndividualData(full);
  assert.equal(redacted.redacted, true);
  assert.deepEqual(redacted.perStudent, []);
});

// ---------------------------------------------------------------------------
// viewerRoleForClassroom
// ---------------------------------------------------------------------------

test("viewerRoleForClassroom resolves a concrete viewer to an analytics role", () => {
  const classroom = { teacherId: "t1", orgId: "o1" };

  assert.equal(
    ta.viewerRoleForClassroom({ viewer: { id: "x", role: "Admin" }, classroom, isOrgAdmin: false }),
    "systemAdmin",
  );
  assert.equal(
    ta.viewerRoleForClassroom({ viewer: { id: "t1", role: "Reader" }, classroom, isOrgAdmin: false }),
    "teacher",
  );
  // An org admin who is NOT the teacher gets aggregate-only `orgAdmin`.
  assert.equal(
    ta.viewerRoleForClassroom({ viewer: { id: "z", role: "Reader" }, classroom, isOrgAdmin: true }),
    "orgAdmin",
  );
  assert.equal(
    ta.viewerRoleForClassroom({ viewer: { id: "z", role: "Reader" }, classroom, isOrgAdmin: false }),
    "learner",
  );
});
