/**
 * Unit tests for the classroom reading-skills matrix (#1302):
 * classroom/skills.ts aggregation and GET /api/classrooms/[id]/skills.
 *
 * Covers latest-attempt-per-article selection, per-student and class totals,
 * aggregate-only (org admin) redaction, empty classrooms, unknown skill rows,
 * and the route's JSON/CSV output with access errors passed through.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors/api-error";
import { type RouteHandler, getReq, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type Attempt = { id: string; userId: string; articleId: string };

type Member = { userId: string; user: { name: string | null; email: string | null } };

let members: Member[] = [
  { userId: "s1", user: { name: "Ada", email: "ada@example.com" } },
  { userId: "s2", user: { name: null, email: "bo@example.com" } },
];
let assignments = [{ articleId: "a1" }, { articleId: "a2" }, { articleId: "a1" }];
let attempts: Attempt[] = [];
let answers: Array<{ attemptId: string; skillTag: string; correct: boolean }> = [];
let attemptQueries: Array<Record<string, unknown>> = [];
let answerQueries: Array<Record<string, unknown>> = [];

let authState: AuthState = "ok";
let scopedError: ApiError | null = null;
let scopedResult: { role: string; matrix: unknown } = { role: "teacher", matrix: {} };

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        classroomMembership: { findMany: async () => members },
        assignment: { findMany: async () => assignments },
        quizAttempt: {
          findMany: async (args: Record<string, unknown>) => {
            attemptQueries.push(args);
            return attempts;
          },
        },
        quizAttemptAnswer: {
          findMany: async (args: { where: { attemptId: { in: string[] } } }) => {
            answerQueries.push(args);
            return answers.filter((answer) => args.where.attemptId.in.includes(answer.attemptId));
          },
        },
      },
    },
  });
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });
  mock.module("@/lib/analytics/classroom-access", {
    namedExports: {
      getScopedClassroomSkills: async () => {
        if (scopedError) throw scopedError;
        return scopedResult;
      },
    },
  });
});

beforeEach(() => {
  members = [
    { userId: "s1", user: { name: "Ada", email: "ada@example.com" } },
    { userId: "s2", user: { name: null, email: "bo@example.com" } },
  ];
  assignments = [{ articleId: "a1" }, { articleId: "a2" }, { articleId: "a1" }];
  // Newest first, as the query orders them: s1 retook a1 (t3 is latest).
  attempts = [
    { id: "t3", userId: "s1", articleId: "a1" },
    { id: "t2", userId: "s2", articleId: "a2" },
    { id: "t1", userId: "s1", articleId: "a1" },
  ];
  answers = [
    { attemptId: "t3", skillTag: "main_idea", correct: true },
    { attemptId: "t3", skillTag: "vocabulary_in_context", correct: false },
    { attemptId: "t1", skillTag: "main_idea", correct: false },
    { attemptId: "t2", skillTag: "main_idea", correct: false },
    { attemptId: "t2", skillTag: "legacy_skill", correct: true },
  ];
  attemptQueries = [];
  answerQueries = [];
  authState = "ok";
  scopedError = null;
});

async function loadSkills() {
  return import("@/lib/classroom/skills");
}

test("the matrix counts each student's latest attempt per assigned article", async () => {
  const { getClassroomSkillMatrix } = await loadSkills();
  const matrix = await getClassroomSkillMatrix("c1", { individual: true });

  const where = attemptQueries[0]?.where as { userId: { in: string[] }; articleId: { in: string[] } };
  assert.deepEqual(where.userId.in, ["s1", "s2"]);
  assert.deepEqual(where.articleId.in, ["a1", "a2"], "assigned articles are deduplicated");
  assert.deepEqual((answerQueries[0]?.where as { attemptId: { in: string[] } }).attemptId.in.sort(), ["t2", "t3"]);

  assert.equal(matrix.attemptCount, 2);
  assert.equal(matrix.skills.length, 6);
  assert.deepEqual(matrix.classTotals, {
    main_idea: { correct: 1, total: 2 },
    vocabulary_in_context: { correct: 0, total: 1 },
  });
  assert.deepEqual(matrix.students, [
    {
      studentId: "s1",
      name: "Ada",
      email: "ada@example.com",
      cells: { main_idea: { correct: 1, total: 1 }, vocabulary_in_context: { correct: 0, total: 1 } },
    },
    { studentId: "s2", name: null, email: "bo@example.com", cells: { main_idea: { correct: 0, total: 1 } } },
  ]);
});

test("aggregate-only viewers get class totals without student rows", async () => {
  const { getClassroomSkillMatrix } = await loadSkills();
  const matrix = await getClassroomSkillMatrix("c1", { individual: false });
  assert.equal(matrix.students, null);
  assert.deepEqual(matrix.classTotals.main_idea, { correct: 1, total: 2 });
});

test("classrooms without students, assignments, or attempts skip the follow-up queries", async () => {
  const { getClassroomSkillMatrix } = await loadSkills();
  members = [];
  const noStudents = await getClassroomSkillMatrix("c1", { individual: true });
  assert.equal(noStudents.attemptCount, 0);
  assert.deepEqual(noStudents.students, []);

  members = [{ userId: "s1", user: { name: "Ada", email: null } }];
  assignments = [];
  const noAssignments = await getClassroomSkillMatrix("c1", { individual: true });
  assert.deepEqual(noAssignments.students?.[0]?.cells, {});
  assert.equal(attemptQueries.length, 0);

  assignments = [{ articleId: "a1" }];
  attempts = [];
  const noAttempts = await getClassroomSkillMatrix("c1", { individual: true });
  assert.equal(noAttempts.attemptCount, 0);
  assert.equal(answerQueries.length, 0);
});

test("skillCellPercent rounds and reports missing evidence as null", async () => {
  const { skillCellPercent } = await loadSkills();
  assert.equal(skillCellPercent({ correct: 2, total: 3 }), 67);
  assert.equal(skillCellPercent({ correct: 0, total: 0 }), null);
  assert.equal(skillCellPercent(undefined), null);
});

// ---- route -----------------------------------------------------------------

const MATRIX = {
  skills: ["textual_evidence", "main_idea"],
  classTotals: { main_idea: { correct: 1, total: 2 } },
  students: [
    { studentId: "s1", name: "Ada", email: null, cells: { main_idea: { correct: 1, total: 1 } } },
    { studentId: "s2", name: null, email: "bo@example.com", cells: {} },
    { studentId: "s3", name: null, email: null, cells: {} },
  ],
  attemptCount: 2,
};

async function getSkills(url: string): Promise<Response> {
  const { GET } = (await import("@/app/api/classrooms/[id]/skills/route")) as { GET: RouteHandler };
  return GET(getReq(url), withParams({ id: "c1" }));
}

test("skills route returns JSON with the viewer's role", async () => {
  scopedResult = { role: "teacher", matrix: MATRIX };
  const res = await getSkills("http://test/api/classrooms/c1/skills");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: "teacher", matrix: MATRIX });
});

test("skills route exports CSV with a class row", async () => {
  scopedResult = { role: "teacher", matrix: MATRIX };
  const res = await getSkills("http://test/api/classrooms/c1/skills?format=csv");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(res.headers.get("content-disposition") ?? "", /classroom-c1-reading-skills\.csv/);
  const lines = (await res.text()).trim().split(/\r?\n/);
  assert.equal(lines[0], "student,CCRA.R.1 Cite textual evidence,CCRA.R.2 Main idea & summary");
  assert.equal(lines[1], "Ada,,100% (1/1)");
  assert.equal(lines[2], "bo@example.com,,");
  assert.equal(lines[3], "s3,,");
  assert.equal(lines[4], "Class,,50% (1/2)");

  scopedResult = { role: "orgAdmin", matrix: { ...MATRIX, students: null } };
  const aggregate = (await (await getSkills("http://test/api/classrooms/c1/skills?format=csv")).text())
    .trim()
    .split(/\r?\n/);
  assert.equal(aggregate.length, 2, "org admins get only the header and class rows");
});

test("skills route passes auth and access errors through", async () => {
  authState = "unauth";
  assert.equal((await getSkills("http://test/api/classrooms/c1/skills")).status, 401);
  authState = "ok";
  scopedError = new ApiError(403, "Forbidden");
  assert.equal((await getSkills("http://test/api/classrooms/c1/skills")).status, 403);
});
