process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type IntegrityResult =
  | { ok: true; article: { id: string } }
  | {
      ok: false;
      status: 404 | 409;
      reason:
        | "article_not_found"
        | "org_reference_mismatch"
        | "org_visibility_without_org"
        | "org_reference_without_org_visibility"
        | "org_reference_orphaned";
    };

let integrityResult: IntegrityResult;
let integrityCalls: Array<{ articleId: string; organizationId: string }>;
let createCalls: Array<{ data: Record<string, unknown> }>;
let assignmentThrows: boolean;

before(() => {
  mock.module("@/lib/article-library/tenant-integrity", {
    namedExports: {
      getOrganizationAssignableArticle: async (
        articleId: string,
        organizationId: string,
      ) => {
        integrityCalls.push({ articleId, organizationId });
        return integrityResult;
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        assignment: {
          create: async (input: { data: Record<string, unknown> }) => {
            createCalls.push(input);
            if (assignmentThrows) throw new Error("assignment unavailable");
            return { id: "assignment-1", ...input.data };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  integrityResult = { ok: true, article: { id: "article-1" } };
  integrityCalls = [];
  createCalls = [];
  assignmentThrows = false;
});

async function create(overrides: Partial<{
  classroomId: string;
  organizationId: string;
  articleId: string;
  dueDate: string;
  instructions: string | null;
}> = {}) {
  const { createArticleAssignment } = await import(
    "@/lib/classroom/article-assignments"
  );
  return createArticleAssignment({
    classroomId: "classroom-1",
    organizationId: "organization-1",
    articleId: "article-1",
    ...overrides,
  });
}

test("passes authorized organization context to Article Library", async () => {
  await create();

  assert.deepEqual(integrityCalls, [{
    articleId: "article-1",
    organizationId: "organization-1",
  }]);
});

test("preserves concealed 404 and integrity 409 outcomes without inserting", async () => {
  integrityResult = {
    ok: false,
    status: 404,
    reason: "org_reference_mismatch",
  };
  assert.deepEqual(await create({ dueDate: "not-a-date" }), integrityResult);
  assert.deepEqual(createCalls, []);

  integrityResult = {
    ok: false,
    status: 409,
    reason: "org_reference_orphaned",
  };
  assert.deepEqual(await create(), integrityResult);
  assert.deepEqual(createCalls, []);
});

test("validates article integrity before parsing the due date", async () => {
  integrityResult = {
    ok: false,
    status: 404,
    reason: "article_not_found",
  };

  const result = await create({ dueDate: "not-a-date" });

  assert.deepEqual(result, integrityResult);
});

test("returns invalid_due_date only after article validation succeeds", async () => {
  const result = await create({ dueDate: "not-a-date" });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    reason: "invalid_due_date",
  });
  assert.deepEqual(createCalls, []);
});

test("normalizes optional fields and creates the assignment", async () => {
  const result = await create({
    dueDate: "2026-12-31",
    instructions: "  Read carefully  ",
  });

  assert.equal(result.ok, true);
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].data, {
    classroomId: "classroom-1",
    articleId: "article-1",
    dueDate: new Date("2026-12-31"),
    instructions: "Read carefully",
  });
});

test("stores null for absent due date and blank instructions", async () => {
  await create({ instructions: "   " });

  assert.deepEqual(createCalls[0].data, {
    classroomId: "classroom-1",
    articleId: "article-1",
    dueDate: null,
    instructions: null,
  });
});

test("propagates unexpected persistence failures", async () => {
  assignmentThrows = true;
  await assert.rejects(() => create(), /assignment unavailable/);
});