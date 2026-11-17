/**
 * HTTP route tests for reader activities and lesson tools (#1304). Domain
 * modules are mocked (PostgreSQL behaviour lives in tests/db/activities.test.ts).
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors/api-error";
import { type RouteHandler, getReq, jsonPost, makeJsonRequest, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type Failure = { ok: false; status: number; reason: string };
type AuditFactory = (entry: { action: string; targetId: string; metadata: Record<string, unknown> }) => Record<string, unknown>;

let authState: AuthState = "ok";
let educator = true;
let articleReadable = true;
let failure: Failure | null = null;
let scaffold: unknown = { hook: "H", questions: ["Q?"], keyTerms: [], fallback: true };
let calls: Array<{ fn: string; args: unknown[] }> = [];
let audits: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });
  mock.module("@/lib/classroom/educator", { namedExports: { isEducator: async () => educator } });
  mock.module("@/lib/reader/route-guard", {
    namedExports: {
      requireReadableArticle: async (id: string) => {
        if (!articleReadable) throw new ApiError(404, "Article not found");
        return { article: { id }, context: {} };
      },
      requireReadableArticleForAI: async (id: string) => {
        if (!articleReadable) throw new ApiError(404, "Article not found");
        return { article: { id }, context: { role: "Reader" } };
      },
    },
  });
  mock.module("@/lib/lesson/scaffold", {
    namedExports: {
      getOrCreateLessonScaffold: async (articleId: string) => {
        calls.push({ fn: "scaffold", args: [articleId] });
        return scaffold;
      },
    },
  });
  mock.module("@/lib/classroom/activities", {
    namedExports: {
      CHECK_OPTIONS_MAX: 4,
      POLL_OPTIONS_MAX: 5,
      getReaderActivities: async (viewer: { id: string }, articleId: string, opts: unknown) => {
        calls.push({ fn: "reader", args: [viewer.id, articleId, opts] });
        return { mode: "student", polls: [], checks: [] };
      },
      votePoll: async (_viewer: unknown, id: string, optionIndex: number) => {
        calls.push({ fn: "vote", args: [id, optionIndex] });
        return failure ?? { ok: true, myVote: optionIndex, distribution: [1, 0] };
      },
      answerCheck: async (_viewer: unknown, id: string, selectedIndex: number) => {
        calls.push({ fn: "answer", args: [id, selectedIndex] });
        return failure ?? { ok: true, result: { selectedIndex, correct: true, correctIndex: 0, explanation: null } };
      },
      getAssignmentActivities: async (_viewer: unknown, id: string) => {
        calls.push({ fn: "activities", args: [id] });
        return failure ?? { ok: true, activities: { assignment: { id }, poll: null, checks: [] } };
      },
      saveAssignmentPoll: async (_viewer: unknown, id: string, input: unknown, audit: AuditFactory) => {
        calls.push({ fn: "savePoll", args: [id, input] });
        audits.push(audit({ action: "assignment_poll.save", targetId: "p1", metadata: { assignmentId: id } }));
        return failure ?? { ok: true, pollId: "p1" };
      },
      deleteAssignmentPoll: async (_viewer: unknown, id: string, audit: AuditFactory) => {
        calls.push({ fn: "deletePoll", args: [id] });
        audits.push(audit({ action: "assignment_poll.delete", targetId: "p1", metadata: {} }));
        return failure ?? { ok: true };
      },
      addAssignmentCheck: async (_viewer: unknown, id: string, input: unknown, audit: AuditFactory) => {
        calls.push({ fn: "addCheck", args: [id, input] });
        audits.push(audit({ action: "assignment_check.create", targetId: "c1", metadata: {} }));
        return failure ?? { ok: true, checkId: "c1" };
      },
      deleteAssignmentCheck: async (_viewer: unknown, id: string, audit: AuditFactory) => {
        calls.push({ fn: "deleteCheck", args: [id] });
        audits.push(audit({ action: "assignment_check.delete", targetId: id, metadata: {} }));
        return failure ?? { ok: true };
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  educator = true;
  articleReadable = true;
  failure = null;
  scaffold = { hook: "H", questions: ["Q?"], keyTerms: [], fallback: true };
  calls = [];
  audits = [];
});

async function routes() {
  return {
    lesson: (await import("@/app/api/reader/[id]/lesson/route")) as { POST: RouteHandler },
    reader: (await import("@/app/api/reader/[id]/activities/route")) as { GET: RouteHandler },
    vote: (await import("@/app/api/assignment-polls/[id]/vote/route")) as { POST: RouteHandler },
    answer: (await import("@/app/api/assignment-checks/[id]/answer/route")) as { POST: RouteHandler },
    check: (await import("@/app/api/assignment-checks/[id]/route")) as { DELETE: RouteHandler },
    activities: (await import("@/app/api/assignments/[id]/activities/route")) as { GET: RouteHandler },
    poll: (await import("@/app/api/assignments/[id]/poll/route")) as { PUT: RouteHandler; DELETE: RouteHandler },
    checks: (await import("@/app/api/assignments/[id]/checks/route")) as { POST: RouteHandler },
  };
}

const article = withParams({ id: "a1" });
const assignment = withParams({ id: "as1" });
const CHECK = { afterBlock: 2, question: "Q?", options: ["A", "B"], correctIndex: 1, explanation: "Because." };

test("activity routes require a session", async () => {
  authState = "unauth";
  const r = await routes();
  assert.equal((await r.lesson.POST(jsonPost("http://test/api/reader/a1/lesson", {}), article)).status, 401);
  assert.equal((await r.reader.GET(getReq("http://test/api/reader/a1/activities"), article)).status, 401);
  assert.equal((await r.vote.POST(jsonPost("http://test/x", { optionIndex: 0 }), withParams({ id: "p1" }))).status, 401);
  assert.equal((await r.answer.POST(jsonPost("http://test/x", { selectedIndex: 0 }), withParams({ id: "c1" }))).status, 401);
  assert.equal((await r.activities.GET(getReq("http://test/x"), assignment)).status, 401);
  assert.deepEqual(calls, []);
});

test("lesson scaffolds are for educators only", async () => {
  const r = await routes();
  const res = await r.lesson.POST(jsonPost("http://test/api/reader/a1/lesson", {}), article);
  assert.deepEqual(await res.json(), { hook: "H", questions: ["Q?"], keyTerms: [], fallback: true });
  scaffold = null;
  assert.equal((await r.lesson.POST(jsonPost("http://test/api/reader/a1/lesson", {}), article)).status, 404);
  articleReadable = false;
  assert.equal((await r.lesson.POST(jsonPost("http://test/api/reader/a1/lesson", {}), article)).status, 404);
  educator = false;
  calls = [];
  assert.equal((await r.lesson.POST(jsonPost("http://test/api/reader/a1/lesson", {}), article)).status, 403);
  assert.deepEqual(calls, []);
});

test("the reader activities preview is limited to educators", async () => {
  const r = await routes();
  await r.reader.GET(getReq("http://test/api/reader/a1/activities?preview=1"), article);
  assert.deepEqual(calls.at(-1), { fn: "reader", args: ["user-1", "a1", { preview: true }] });
  educator = false;
  await r.reader.GET(getReq("http://test/api/reader/a1/activities?preview=1"), article);
  assert.deepEqual(calls.at(-1)?.args[2], { preview: false });
  await r.reader.GET(getReq("http://test/api/reader/a1/activities"), article);
  assert.deepEqual(calls.at(-1)?.args[2], { preview: false });
  articleReadable = false;
  assert.equal((await r.reader.GET(getReq("http://test/api/reader/a1/activities"), article)).status, 404);
});

test("students vote and answer; failures map to statuses", async () => {
  const r = await routes();
  const vote = await r.vote.POST(jsonPost("http://test/x", { optionIndex: 0 }), withParams({ id: "p1" }));
  assert.deepEqual(await vote.json(), { myVote: 0, distribution: [1, 0] });
  const answer = await r.answer.POST(jsonPost("http://test/x", { selectedIndex: 1 }), withParams({ id: "c1" }));
  assert.deepEqual(await answer.json(), { result: { selectedIndex: 1, correct: true, correctIndex: 0, explanation: null } });
  assert.equal((await r.vote.POST(jsonPost("http://test/x", { optionIndex: -1 }), withParams({ id: "p1" }))).status, 400);

  const cases: Array<[Failure, number, string]> = [
    [{ ok: false, status: 409, reason: "already_answered" }, 409, "You already answered this check"],
    [{ ok: false, status: 400, reason: "invalid_option" }, 400, "Choose one of the options"],
    [{ ok: false, status: 404, reason: "not_found" }, 404, "Not found"],
  ];
  for (const [next, status, message] of cases) {
    failure = next;
    const res = await r.answer.POST(jsonPost("http://test/x", { selectedIndex: 0 }), withParams({ id: "c1" }));
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: string }).error, message);
  }
  failure = { ok: false, status: 404, reason: "not_found" };
  assert.equal((await r.vote.POST(jsonPost("http://test/x", { optionIndex: 0 }), withParams({ id: "p1" }))).status, 404);
});

test("teachers manage polls and checks; changes are audited by id", async () => {
  const r = await routes();
  assert.deepEqual(await (await r.activities.GET(getReq("http://test/x"), assignment)).json(), {
    assignment: { id: "as1" },
    poll: null,
    checks: [],
  });
  const poll = await r.poll.PUT(makeJsonRequest("http://test/x", "PUT", { question: " Q? ", options: ["A", "B"] }), assignment);
  assert.deepEqual(await poll.json(), { pollId: "p1" });
  assert.deepEqual(calls.at(-1), { fn: "savePoll", args: ["as1", { question: "Q?", options: ["A", "B"] }] });
  assert.equal((await r.poll.DELETE(makeJsonRequest("http://test/x", "DELETE"), assignment)).status, 200);
  const created = await r.checks.POST(jsonPost("http://test/x", CHECK), assignment);
  assert.equal(created.status, 201);
  assert.deepEqual(calls.at(-1), { fn: "addCheck", args: ["as1", CHECK] });
  assert.equal((await r.check.DELETE(makeJsonRequest("http://test/x", "DELETE"), withParams({ id: "c1" }))).status, 200);
  assert.deepEqual(
    audits.map((entry) => [entry.action, entry.targetType]),
    [
      ["assignment_poll.save", "assignment_poll"],
      ["assignment_poll.delete", "assignment_poll"],
      ["assignment_check.create", "assignment_check"],
      ["assignment_check.delete", "assignment_check"],
    ],
  );

  calls = [];
  for (const body of [{ ...CHECK, correctIndex: 9 }, { ...CHECK, options: ["A", "B", "C", "D", "E"] }, { ...CHECK, question: "" }]) {
    assert.equal((await r.checks.POST(jsonPost("http://test/x", body), assignment)).status, 400);
  }
  assert.equal((await r.poll.PUT(makeJsonRequest("http://test/x", "PUT", { question: "Q" }), assignment)).status, 400);
  assert.deepEqual(calls, []);

  failure = { ok: false, status: 403, reason: "forbidden" };
  assert.equal((await r.activities.GET(getReq("http://test/x"), assignment)).status, 403);
  assert.equal((await r.poll.PUT(makeJsonRequest("http://test/x", "PUT", { question: "Q", options: ["A", "B"] }), assignment)).status, 403);
  assert.equal((await r.poll.DELETE(makeJsonRequest("http://test/x", "DELETE"), assignment)).status, 403);
  assert.equal((await r.checks.POST(jsonPost("http://test/x", CHECK), assignment)).status, 403);
  assert.equal((await r.check.DELETE(makeJsonRequest("http://test/x", "DELETE"), withParams({ id: "c1" }))).status, 403);
  failure = { ok: false, status: 409, reason: "archived" };
  const archived = await r.checks.POST(jsonPost("http://test/x", CHECK), assignment);
  assert.equal(((await archived.json()) as { error: string }).error, "Classroom is archived");
  failure = { ok: false, status: 400, reason: "invalid_activity" };
  assert.equal((await r.poll.PUT(makeJsonRequest("http://test/x", "PUT", { question: "Q", options: ["A", "A"] }), assignment)).status, 400);
});
