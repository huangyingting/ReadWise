process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let lastFindManyArgs: Record<string, unknown> | null = null;
let userRows: Record<string, unknown>[] = [];
let userTotal = 0;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          count: async () => userTotal,
          findMany: async (args: Record<string, unknown>) => {
            lastFindManyArgs = args;
            return userRows;
          },
        },
        readingProgress: {
          groupBy: async () => [],
        },
      },
    },
  });
});

beforeEach(() => {
  lastFindManyArgs = null;
  userTotal = 1;
  userRows = [
    {
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      image: null,
      role: "Reader",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      _count: { savedWords: 2, readingProgress: 3 },
    },
  ];
});

test("listMembers applies accessible table sort parameters to the query", async () => {
  const { listMembers } = await import("@/lib/account-lifecycle/member-list");

  const result = await listMembers({ sort: "name", order: "asc" });

  assert.equal(result.sort, "name");
  assert.equal(result.order, "asc");
  assert.deepEqual(lastFindManyArgs?.orderBy, [
    { name: "asc" },
    { email: "asc" },
    { createdAt: "desc" },
  ]);
});

test("listMembers filters by query and role while sorting activity", async () => {
  const { listMembers } = await import("@/lib/account-lifecycle/member-list");

  const result = await listMembers({
    query: "  ada  ",
    role: "Reader",
    sort: "activity",
    order: "desc",
  });

  assert.equal(result.query, "ada");
  assert.equal(result.role, "Reader");
  assert.deepEqual(lastFindManyArgs?.where, {
    role: "Reader",
    OR: [
      { name: { contains: "ada" } },
      { email: { contains: "ada" } },
    ],
  });
  assert.deepEqual(lastFindManyArgs?.orderBy, [
    { readingProgress: { _count: "desc" } },
    { savedWords: { _count: "desc" } },
    { createdAt: "desc" },
  ]);
});

test("listMembers falls back to newest-first sorting for unknown values", async () => {
  const { listMembers } = await import("@/lib/account-lifecycle/member-list");

  const result = await listMembers({ sort: "unknown", order: "sideways" });

  assert.equal(result.sort, "createdAt");
  assert.equal(result.order, "desc");
  assert.deepEqual(lastFindManyArgs?.orderBy, [{ createdAt: "desc" }]);
});
