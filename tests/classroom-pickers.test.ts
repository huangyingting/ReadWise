process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let lastUserFindManyArgs: Record<string, unknown> | null = null;
let lastArticleFindManyArgs: Record<string, unknown> | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findMany: async (args: Record<string, unknown>) => {
            lastUserFindManyArgs = args;
            return [];
          },
        },
        article: {
          findMany: async (args: Record<string, unknown>) => {
            lastArticleFindManyArgs = args;
            return [];
          },
        },
      },
    },
  });
});

beforeEach(() => {
  lastUserFindManyArgs = null;
  lastArticleFindManyArgs = null;
});

test("student picker searches by name or email while excluding current roster", async () => {
  const { searchClassroomStudentCandidates } = await import("@/lib/classroom/queries");

  await searchClassroomStudentCandidates("class-1", " ada ");

  const where = lastUserFindManyArgs?.where as {
    classroomMemberships?: { none?: { classroomId?: string } };
    OR?: Array<Record<string, unknown>>;
  };
  assert.equal(where.classroomMemberships?.none?.classroomId, "class-1");
  assert.deepEqual(where.OR, [
    { name: { contains: "ada" } },
    { email: { contains: "ada" } },
  ]);
});

test("article picker searches readable articles by title, author, or source", async () => {
  const { searchAssignableArticleOptions } = await import("@/lib/classroom/queries");

  await searchAssignableArticleOptions({ userId: "u1", role: "Reader" }, "climate");

  const where = lastArticleFindManyArgs?.where as { AND?: unknown[] };
  assert.ok(Array.isArray(where.AND), "reader access and picker search should be combined");
  assert.deepEqual(where.AND?.[1], {
    OR: [
      { title: { contains: "climate" } },
      { author: { contains: "climate" } },
      { source: { contains: "climate" } },
    ],
  });
});
