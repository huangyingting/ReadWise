/**
 * Unit tests for admin organization read models.
 *
 * Archived classrooms are historical lifecycle state and must not be silently
 * mixed into active classroom counts/lists shown by the admin org views.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt?: Date;
  _count: { memberships: number };
};

let countResult = 0;
let findManyResult: OrgRow[] = [];
let findUniqueResult: Record<string, unknown> | null = null;
let groupByResult: Array<{ orgId: string; _count: { _all: number } }> = [];

const organizationCountCalls: unknown[] = [];
const organizationFindManyCalls: unknown[] = [];
const organizationFindUniqueCalls: unknown[] = [];
const classroomGroupByCalls: unknown[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        organization: {
          count: async (args: unknown) => {
            organizationCountCalls.push(args);
            return countResult;
          },
          findMany: async (args: unknown) => {
            organizationFindManyCalls.push(args);
            return findManyResult;
          },
          findUnique: async (args: unknown) => {
            organizationFindUniqueCalls.push(args);
            return findUniqueResult;
          },
        },
        classroom: {
          groupBy: async (args: unknown) => {
            classroomGroupByCalls.push(args);
            return groupByResult;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  countResult = 0;
  findManyResult = [];
  findUniqueResult = null;
  groupByResult = [];
  organizationCountCalls.length = 0;
  organizationFindManyCalls.length = 0;
  organizationFindUniqueCalls.length = 0;
  classroomGroupByCalls.length = 0;
});

async function queries() {
  return import("@/lib/admin/organizations/queries");
}

async function detail() {
  return import("@/lib/admin/organizations/detail");
}

function orgRow(id: string, createdAt: string, memberships = 1): OrgRow {
  return {
    id,
    name: `Org ${id}`,
    slug: id,
    createdAt: new Date(createdAt),
    _count: { memberships },
  };
}

test("listOrganizations reports active classroom counts only", async () => {
  countResult = 1;
  findManyResult = [orgRow("org-1", "2026-07-01T00:00:00.000Z", 3)];
  groupByResult = [{ orgId: "org-1", _count: { _all: 2 } }];

  const { listOrganizations } = await queries();
  const result = await listOrganizations();

  assert.equal(result.organizations[0]?.memberCount, 3);
  assert.equal(result.organizations[0]?.classroomCount, 2);
  const groupByArgs = classroomGroupByCalls[0] as {
    where: { orgId: { in: string[] }; archivedAt: null };
  };
  assert.deepEqual(groupByArgs.where.orgId.in, ["org-1"]);
  assert.equal(groupByArgs.where.archivedAt, null);
});

test("listOrganizations sorts the classrooms column by active classroom counts", async () => {
  findManyResult = [
    orgRow("org-archived-only", "2026-07-02T00:00:00.000Z"),
    orgRow("org-active", "2026-07-01T00:00:00.000Z"),
  ];
  groupByResult = [{ orgId: "org-active", _count: { _all: 3 } }];

  const { listOrganizations } = await queries();
  const result = await listOrganizations({ sort: "classrooms", order: "desc" });

  assert.deepEqual(result.organizations.map((org) => org.id), [
    "org-active",
    "org-archived-only",
  ]);
  assert.equal(result.organizations[0]?.classroomCount, 3);
  assert.equal(result.organizations[1]?.classroomCount, 0);
});

test("getOrganizationDetail lists and counts active classrooms only", async () => {
  const activeClassroom = {
    id: "class-active",
    name: "Active class",
    createdAt: new Date("2026-07-03T00:00:00.000Z"),
    teacher: { name: "Teacher", email: "teacher@example.com" },
    _count: { assignments: 2 },
  };
  findUniqueResult = {
    id: "org-1",
    name: "Org 1",
    slug: "org-1",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    _count: { memberships: 4 },
    memberships: [],
    classrooms: [activeClassroom],
  };

  const { getOrganizationDetail } = await detail();
  const result = await getOrganizationDetail("org-1");

  const findUniqueArgs = organizationFindUniqueCalls[0] as {
    include: { classrooms: { where: { archivedAt: null } } };
  };
  assert.equal(findUniqueArgs.include.classrooms.where.archivedAt, null);
  assert.equal(result?.memberCount, 4);
  assert.equal(result?.classroomCount, 1);
  assert.deepEqual(result?.classrooms.map((classroom) => classroom.id), ["class-active"]);
});
