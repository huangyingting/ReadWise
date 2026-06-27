/**
 * Unit tests for classroom read queries (classroom/queries.ts).
 *
 * Verifies that each query is correctly user/role/org-scoped and that the
 * returned row shape is properly mapped. All Prisma calls are mocked — no real
 * DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable stub state ---------------------------------------------------

let classroomStub: Record<string, unknown> | null = null;
let classroomListStub: Record<string, unknown>[] = [];
let membershipListStub: Record<string, unknown>[] = [];

let lastClassroomFindManyWhere: unknown = null;

// ---- mock setup ------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        classroom: {
          findUnique: async () => classroomStub,
          findMany: async (args: { where?: unknown }) => {
            lastClassroomFindManyWhere = args?.where;
            return classroomListStub;
          },
        },
        classroomMembership: {
          findMany: async () => membershipListStub,
        },
      },
    },
  });
});

beforeEach(() => {
  classroomStub = null;
  classroomListStub = [];
  membershipListStub = [];
  lastClassroomFindManyWhere = null;
});

// ---- getClassroom ----------------------------------------------------------

test("getClassroom returns the classroom when it exists", async () => {
  classroomStub = { id: "c1", name: "Algebra", orgId: "o1", teacherId: "t1" };
  const { getClassroom } = await import("@/lib/classroom/queries");
  const result = await getClassroom("c1");
  assert.deepEqual(result, classroomStub);
});

test("getClassroom returns null when the classroom does not exist", async () => {
  classroomStub = null;
  const { getClassroom } = await import("@/lib/classroom/queries");
  const result = await getClassroom("missing");
  assert.equal(result, null);
});

// ---- listClassroomsForOrg --------------------------------------------------

test("listClassroomsForOrg returns classrooms scoped to the given org", async () => {
  classroomListStub = [
    { id: "c1", orgId: "o1" },
    { id: "c2", orgId: "o1" },
  ];
  const { listClassroomsForOrg } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForOrg("o1");
  assert.equal(result.length, 2);
  const where = lastClassroomFindManyWhere as { orgId: string };
  assert.equal(where.orgId, "o1");
});

test("listClassroomsForOrg returns empty array when org has no classrooms", async () => {
  classroomListStub = [];
  const { listClassroomsForOrg } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForOrg("empty-org");
  assert.deepEqual(result, []);
});

test("listClassroomsForOrg does not return classrooms belonging to a different org", async () => {
  classroomListStub = [];
  const { listClassroomsForOrg } = await import("@/lib/classroom/queries");
  await listClassroomsForOrg("org-a");
  const where = lastClassroomFindManyWhere as { orgId: string };
  assert.equal(where.orgId, "org-a");
});

// ---- listClassroomsForTeacher ----------------------------------------------

test("listClassroomsForTeacher includes classrooms where user is the primary teacher", async () => {
  classroomListStub = [{ id: "c1", teacherId: "t1" }];
  const { listClassroomsForTeacher } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForTeacher("t1");
  assert.equal(result.length, 1);
  const where = lastClassroomFindManyWhere as { OR: { teacherId?: string }[] };
  assert.ok(where.OR.some((clause) => clause.teacherId === "t1"));
});

test("listClassroomsForTeacher includes classrooms where user is a Teacher member", async () => {
  classroomListStub = [{ id: "c2", teacherId: "other" }];
  const { listClassroomsForTeacher } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForTeacher("t2");
  assert.equal(result.length, 1);
  const where = lastClassroomFindManyWhere as { OR: { members?: unknown }[] };
  assert.ok(where.OR.some((clause) => clause.members !== undefined));
});

test("listClassroomsForTeacher query uses an OR condition for primary teacher and Teacher membership", async () => {
  classroomListStub = [];
  const { listClassroomsForTeacher } = await import("@/lib/classroom/queries");
  await listClassroomsForTeacher("t1");
  const where = lastClassroomFindManyWhere as { OR: unknown[] };
  assert.ok(Array.isArray(where.OR));
  assert.equal(where.OR.length, 2);
});

test("listClassroomsForTeacher returns empty array when teacher has no classrooms", async () => {
  classroomListStub = [];
  const { listClassroomsForTeacher } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForTeacher("no-classes");
  assert.deepEqual(result, []);
});

// ---- listClassroomsForStudent ----------------------------------------------

test("listClassroomsForStudent returns classrooms the student is enrolled in", async () => {
  classroomListStub = [{ id: "c1" }, { id: "c3" }];
  const { listClassroomsForStudent } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForStudent("s1");
  assert.equal(result.length, 2);
});

test("listClassroomsForStudent filters by the student's userId", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await import("@/lib/classroom/queries");
  await listClassroomsForStudent("s1");
  const where = lastClassroomFindManyWhere as { members: { some: { userId: string } } };
  assert.equal(where.members.some.userId, "s1");
});

test("listClassroomsForStudent uses a different userId scope per call", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await import("@/lib/classroom/queries");
  await listClassroomsForStudent("student-99");
  const where = lastClassroomFindManyWhere as { members: { some: { userId: string } } };
  assert.equal(where.members.some.userId, "student-99");
});

test("listClassroomsForStudent returns empty array when student is not enrolled anywhere", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await import("@/lib/classroom/queries");
  const result = await listClassroomsForStudent("unenrolled");
  assert.deepEqual(result, []);
});

// ---- listClassroomMembers --------------------------------------------------

test("listClassroomMembers maps rows to ClassroomMemberRow shape", async () => {
  membershipListStub = [
    {
      userId: "t1",
      role: "Teacher",
      createdAt: new Date(),
      user: { id: "t1", name: "Alice", email: "alice@e.com", image: "img.png" },
    },
    {
      userId: "s1",
      role: "Student",
      createdAt: new Date(),
      user: { id: "s1", name: "Bob", email: "bob@e.com", image: null },
    },
  ];
  const { listClassroomMembers } = await import("@/lib/classroom/queries");
  const result = await listClassroomMembers("c1");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    userId: "t1",
    role: "Teacher",
    name: "Alice",
    email: "alice@e.com",
    image: "img.png",
  });
  assert.deepEqual(result[1], {
    userId: "s1",
    role: "Student",
    name: "Bob",
    email: "bob@e.com",
    image: null,
  });
});

test("listClassroomMembers returns empty array for a classroom with no members", async () => {
  membershipListStub = [];
  const { listClassroomMembers } = await import("@/lib/classroom/queries");
  const result = await listClassroomMembers("empty-c");
  assert.deepEqual(result, []);
});

test("listClassroomMembers handles null name, email, and image gracefully", async () => {
  membershipListStub = [
    {
      userId: "s2",
      role: "Student",
      createdAt: new Date(),
      user: { id: "s2", name: null, email: null, image: null },
    },
  ];
  const { listClassroomMembers } = await import("@/lib/classroom/queries");
  const result = await listClassroomMembers("c2");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    userId: "s2",
    role: "Student",
    name: null,
    email: null,
    image: null,
  });
});

test("listClassroomMembers preserves all rows without filtering", async () => {
  membershipListStub = [
    { userId: "t1", role: "Teacher", createdAt: new Date(), user: { id: "t1", name: "T", email: "t@e.com", image: null } },
    { userId: "s1", role: "Student", createdAt: new Date(), user: { id: "s1", name: "S1", email: "s1@e.com", image: null } },
    { userId: "s2", role: "Student", createdAt: new Date(), user: { id: "s2", name: "S2", email: "s2@e.com", image: null } },
  ];
  const { listClassroomMembers } = await import("@/lib/classroom/queries");
  const result = await listClassroomMembers("c1");
  assert.equal(result.length, 3);
  assert.equal(result[0].userId, "t1");
  assert.equal(result[1].userId, "s1");
  assert.equal(result[2].userId, "s2");
});
