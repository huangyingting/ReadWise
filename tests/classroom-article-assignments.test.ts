process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  type Article,
  type Prisma,
} from "@prisma/client";
import { buildArticle } from "./helpers";

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
let targetCreateManyCalls: Array<{ data: Array<Record<string, unknown>> }>;
let membershipFindManyCalls: Array<Record<string, unknown>>;
let transactionCalls: number;
let assignmentThrows: boolean;
let articleRows: Article[];
let enrolledStudentRows: Array<{ userId: string }>;

function matchesWhere(article: Article, where: Prisma.ArticleWhereInput = {}): boolean {
  const record = article as unknown as Record<string, unknown>;
  const clauses = where as Record<string, unknown>;
  const and = clauses.AND;
  if (Array.isArray(and) && !and.every((clause) => matchesWhere(article, clause as Prisma.ArticleWhereInput))) {
    return false;
  }
  const or = clauses.OR;
  if (Array.isArray(or) && !or.some((clause) => matchesWhere(article, clause as Prisma.ArticleWhereInput))) {
    return false;
  }
  for (const [key, expected] of Object.entries(clauses)) {
    if (key === "AND" || key === "OR") continue;
    const actual = record[key];
    if (expected && typeof expected === "object" && "in" in expected) {
      const values = (expected as { in?: unknown[] }).in ?? [];
      if (!values.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function project(article: Article, select?: Record<string, boolean>): unknown {
  if (!select) return article;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, include]) => include)
      .map(([key]) => [key, (article as unknown as Record<string, unknown>)[key]]),
  );
}

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
        article: {
          findFirst: async (args: {
            where?: Prisma.ArticleWhereInput;
            select?: Record<string, boolean>;
          }) => {
            const found = articleRows.find((article) => matchesWhere(article, args.where));
            return found ? project(found, args.select) : null;
          },
        },
        assignment: {
          create: async (input: { data: Record<string, unknown> }) => {
            createCalls.push(input);
            if (assignmentThrows) throw new Error("assignment unavailable");
            return { id: "assignment-1", ...input.data };
          },
        },
        assignmentTarget: {
          createMany: async (input: { data: Array<Record<string, unknown>> }) => {
            targetCreateManyCalls.push(input);
            return { count: input.data.length };
          },
        },
        classroomMembership: {
          findMany: async (input: Record<string, unknown>) => {
            membershipFindManyCalls.push(input);
            return enrolledStudentRows;
          },
        },
        $transaction: async <T>(callback: (tx: {
          assignment: {
            create: (input: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
          };
          assignmentTarget: {
            createMany: (input: { data: Array<Record<string, unknown>> }) => Promise<{ count: number }>;
          };
        }) => Promise<T>) => {
          transactionCalls += 1;
          return callback({
            assignment: {
              create: async (input: { data: Record<string, unknown> }) => {
                createCalls.push(input);
                if (assignmentThrows) throw new Error("assignment unavailable");
                return { id: "assignment-1", ...input.data };
              },
            },
            assignmentTarget: {
              createMany: async (input: { data: Array<Record<string, unknown>> }) => {
                targetCreateManyCalls.push(input);
                return { count: input.data.length };
              },
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  integrityResult = { ok: true, article: { id: "article-1" } };
  integrityCalls = [];
  createCalls = [];
  targetCreateManyCalls = [];
  membershipFindManyCalls = [];
  transactionCalls = 0;
  assignmentThrows = false;
  enrolledStudentRows = [];
  articleRows = [
    buildArticle({
      id: "article-1",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
      organizationId: null,
    }),
  ];
});

async function create(overrides: Partial<{
  classroomId: string;
  organizationId: string;
  articleId: string;
  dueDate: string;
  instructions: string | null;
  title: string | null;
  points: number | null;
  studentIds: string[];
}> = {}) {
  const { createArticleAssignment } = await import(
    "@/lib/classroom/article-assignments"
  );
  return createArticleAssignment({
    classroomId: "classroom-1",
    organizationId: "organization-1",
    articleId: "article-1",
    accessContext: { userId: "teacher-1", role: "Reader", orgId: "organization-1" },
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

test("rejects draft articles even when organization integrity passes", async () => {
  articleRows = [
    buildArticle({
      id: "draft-article",
      status: ArticleStatus.DRAFT,
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
      organizationId: null,
    }),
  ];

  const result = await create({ articleId: "draft-article" });

  assert.deepEqual(result, {
    ok: false,
    status: 404,
    reason: "article_not_found",
  });
  assert.deepEqual(createCalls, []);
});

test("rejects foreign private articles even when organization integrity passes", async () => {
  articleRows = [
    buildArticle({
      id: "foreign-private",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PRIVATE,
      ownerId: "other-user",
      organizationId: null,
    }),
  ];

  const result = await create({ articleId: "foreign-private" });

  assert.deepEqual(result, {
    ok: false,
    status: 404,
    reason: "article_not_found",
  });
  assert.deepEqual(createCalls, []);
});

test("normalizes optional fields and creates the assignment", async () => {
  const result = await create({
    dueDate: "2026-12-31",
    instructions: "  Read carefully  ",
    title: "  Week 1 reading  ",
    points: 25,
  });

  assert.equal(result.ok, true);
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].data, {
    classroomId: "classroom-1",
    articleId: "article-1",
    dueDate: new Date("2026-12-31T23:59:59.999Z"),
    instructions: "Read carefully",
    title: "Week 1 reading",
    points: 25,
  });
});

test("stores null for absent due date and blank metadata", async () => {
  await create({ instructions: "   ", title: "   " });

  assert.deepEqual(createCalls[0].data, {
    classroomId: "classroom-1",
    articleId: "article-1",
    dueDate: null,
    instructions: null,
    title: null,
    points: null,
  });
});

test("creates target rows atomically for enrolled requested students", async () => {
  enrolledStudentRows = [{ userId: "student-1" }, { userId: "student-3" }];

  const result = await create({
    studentIds: ["student-1", "not-enrolled", "student-3", "student-1"],
  });

  assert.equal(result.ok, true);
  assert.equal(transactionCalls, 1);
  assert.equal(createCalls.length, 1);
  assert.equal(targetCreateManyCalls.length, 1);
  assert.deepEqual(membershipFindManyCalls[0], {
    where: {
      classroomId: "classroom-1",
      role: "Student",
      userId: { in: ["student-1", "not-enrolled", "student-3"] },
    },
    select: { userId: true },
  });
  assert.deepEqual(targetCreateManyCalls[0].data, [
    { assignmentId: "assignment-1", studentId: "student-1" },
    { assignmentId: "assignment-1", studentId: "student-3" },
  ]);
});

test("rejects requested targets when none are enrolled students", async () => {
  enrolledStudentRows = [];

  const result = await create({ studentIds: ["missing-1", "missing-2"] });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    reason: "invalid_target_students",
  });
  assert.equal(transactionCalls, 0);
  assert.deepEqual(createCalls, []);
  assert.deepEqual(targetCreateManyCalls, []);
});

test("omitted or empty studentIds keep the plain whole-class create path", async () => {
  await create();
  await create({ studentIds: [] });

  assert.equal(createCalls.length, 2);
  assert.equal(transactionCalls, 0);
  assert.deepEqual(membershipFindManyCalls, []);
  assert.deepEqual(targetCreateManyCalls, []);
});

test("propagates unexpected persistence failures", async () => {
  assignmentThrows = true;
  await assert.rejects(() => create(), /assignment unavailable/);
});

test("bulkCreateArticleAssignments creates sequentially and collects failures", async () => {
  articleRows = [
    buildArticle({
      id: "article-1",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
      organizationId: null,
    }),
    buildArticle({
      id: "article-2",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
      organizationId: null,
    }),
  ];
  const { bulkCreateArticleAssignments } = await import(
    "@/lib/classroom/article-assignments"
  );

  const result = await bulkCreateArticleAssignments({
    classroomId: "classroom-1",
    organizationId: "organization-1",
    articleIds: ["article-1", "missing", "article-2"],
    accessContext: { userId: "teacher-1", role: "Reader", orgId: "organization-1" },
    dueDate: "2026-12-31",
    instructions: "  Shared instructions  ",
    points: 10,
  });

  assert.equal(result.created.length, 2);
  assert.deepEqual(result.failed, [{ articleId: "missing", reason: "article_not_found" }]);
  assert.deepEqual(
    createCalls.map((call) => call.data.articleId),
    ["article-1", "article-2"],
  );
  assert.deepEqual(createCalls.map((call) => call.data.title), [null, null]);
  assert.deepEqual(createCalls.map((call) => call.data.points), [10, 10]);
});

// ── parseOptionalDueDate unit tests ──────────────────────────────────────────

test("parseOptionalDueDate: date-only resolves to end-of-day UTC", async () => {
  const { parseOptionalDueDate } = await import(
    "@/lib/classroom/article-assignments"
  );
  assert.deepEqual(
    parseOptionalDueDate("2026-12-31"),
    new Date("2026-12-31T23:59:59.999Z"),
  );
});

test("parseOptionalDueDate: full ISO string is preserved unchanged", async () => {
  const { parseOptionalDueDate } = await import(
    "@/lib/classroom/article-assignments"
  );
  assert.deepEqual(
    parseOptionalDueDate("2026-12-31T08:00:00.000Z"),
    new Date("2026-12-31T08:00:00.000Z"),
  );
});

test("parseOptionalDueDate: invalid string returns null", async () => {
  const { parseOptionalDueDate } = await import(
    "@/lib/classroom/article-assignments"
  );
  assert.equal(parseOptionalDueDate("not-a-date"), null);
});

test("parseOptionalDueDate: undefined returns null", async () => {
  const { parseOptionalDueDate } = await import(
    "@/lib/classroom/article-assignments"
  );
  assert.equal(parseOptionalDueDate(undefined), null);
});

test("parseOptionalDueDate: empty string returns null", async () => {
  const { parseOptionalDueDate } = await import(
    "@/lib/classroom/article-assignments"
  );
  assert.equal(parseOptionalDueDate(""), null);
});