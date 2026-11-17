/**
 * HTTP route tests for the Write Prompt API (#1305). Domain commands and the
 * article read guard are mocked (real-database behaviour lives in
 * tests/db/writing.test.ts); these cover auth, validation, status mapping,
 * article access, and audit wiring.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors/api-error";
import { type RouteHandler, getReq, jsonPost, makeJsonRequest, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

type Failure = { ok: false; status: number; reason: string };

let authState: AuthState = "ok";
let articleReadable = true;
let failure: Failure | null = null;
let calls: Array<{ fn: string; args: unknown[] }> = [];
let auditInputs: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });
  mock.module("@/lib/reader/route-guard", {
    namedExports: {
      requireReadableArticle: async (id: string) => {
        if (!articleReadable) throw new ApiError(404, "Article not found");
        return { article: { id, title: "Coral" }, context: {} };
      },
    },
  });
  mock.module("@/lib/classroom/writing", {
    namedExports: {
      getWriteContext: async (userId: string, article: { id: string }, assignmentId: string | null) => {
        calls.push({ fn: "context", args: [userId, article.id, assignmentId] });
        return failure ?? { ok: true, context: { assignments: [], prompt: "P", submission: null } };
      },
      saveWriteDraft: async (userId: string, article: { id: string }, input: unknown) => {
        calls.push({ fn: "draft", args: [userId, article.id, input] });
        return failure ?? { ok: true, submission: { id: "w1", status: "DRAFT" } };
      },
      submitWriteResponse: async (userId: string, article: { id: string }, input: unknown) => {
        calls.push({ fn: "submit", args: [userId, article.id, input] });
        return failure ?? { ok: true, submission: { id: "w1", status: "SUBMITTED" } };
      },
      listAssignmentSubmissions: async (assignmentId: string) => {
        calls.push({ fn: "list", args: [assignmentId] });
        return failure ?? { ok: true, assignment: { id: assignmentId }, submissions: [] };
      },
      reviewWriteSubmission: async (
        id: string,
        _viewer: unknown,
        input: unknown,
        audit: (entry: { action: string; metadata: Record<string, unknown> }) => Record<string, unknown>,
      ) => {
        calls.push({ fn: "review", args: [id, input] });
        auditInputs.push(audit({ action: "write_submission.grade", metadata: { assignmentId: "as1" } }));
        return failure ?? { ok: true, submission: { id, status: "GRADED" } };
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleReadable = true;
  failure = null;
  calls = [];
  auditInputs = [];
});

async function routes() {
  return {
    write: (await import("@/app/api/reader/[id]/write/route")) as { GET: RouteHandler; PUT: RouteHandler },
    submit: (await import("@/app/api/reader/[id]/write/submit/route")) as { POST: RouteHandler },
    list: (await import("@/app/api/assignments/[id]/submissions/route")) as { GET: RouteHandler },
    review: (await import("@/app/api/write-submissions/[id]/review/route")) as { POST: RouteHandler },
  };
}

const WRITE = "http://test/api/reader/a1/write";
const article = withParams({ id: "a1" });
const put = (body: unknown) => makeJsonRequest(WRITE, "PUT", body);

test("write routes require a session", async () => {
  authState = "unauth";
  const r = await routes();
  assert.equal((await r.write.GET(getReq(WRITE), article)).status, 401);
  assert.equal((await r.write.PUT(put({ assignmentId: null, body: "x" }), article)).status, 401);
  assert.equal((await r.submit.POST(jsonPost(`${WRITE}/submit`, { assignmentId: null, body: "x" }), article)).status, 401);
  assert.equal((await r.list.GET(getReq("http://test/api/assignments/as1/submissions"), withParams({ id: "as1" }))).status, 401);
  assert.equal(
    (await r.review.POST(jsonPost("http://test/api/write-submissions/w1/review", { action: "grade", rubricScores: {} }), withParams({ id: "w1" }))).status,
    401,
  );
  assert.deepEqual(calls, []);
});

test("context, draft, and submit act on readable articles for the signed-in learner", async () => {
  const r = await routes();
  assert.deepEqual(await (await r.write.GET(getReq(`${WRITE}?assignmentId=as1`), article)).json(), {
    assignments: [],
    prompt: "P",
    submission: null,
  });
  assert.deepEqual(calls.at(-1), { fn: "context", args: ["user-1", "a1", "as1"] });
  await r.write.GET(getReq(WRITE), article);
  assert.deepEqual(calls.at(-1)?.args[2], null, "no assignmentId means independent writing");

  const draft = await r.write.PUT(put({ assignmentId: null, body: "  keep spacing  " }), article);
  assert.deepEqual(await draft.json(), { submission: { id: "w1", status: "DRAFT" } });
  assert.deepEqual(calls.at(-1)?.args[2], { assignmentId: null, body: "  keep spacing  " });

  const submitted = await r.submit.POST(jsonPost(`${WRITE}/submit`, { assignmentId: "as1", body: "Done" }), article);
  assert.deepEqual(await submitted.json(), { submission: { id: "w1", status: "SUBMITTED" } });

  articleReadable = false;
  assert.equal((await r.write.GET(getReq(WRITE), article)).status, 404);
  assert.equal((await r.write.PUT(put({ assignmentId: null, body: "x" }), article)).status, 404);
});

test("write bodies are validated", async () => {
  const r = await routes();
  assert.equal((await r.write.PUT(put({ assignmentId: null }), article)).status, 400);
  assert.equal((await r.write.PUT(put({ assignmentId: null, body: "x".repeat(20_001) }), article)).status, 400);
  assert.equal((await r.submit.POST(jsonPost(`${WRITE}/submit`, { assignmentId: 5, body: "x" }), article)).status, 400);
  assert.deepEqual(calls, []);
});

test("domain failures map to statuses and messages", async () => {
  const r = await routes();
  const cases: Array<[Failure, number, string]> = [
    [{ ok: false, status: 404, reason: "not_found" }, 404, "Not found"],
    [{ ok: false, status: 409, reason: "locked" }, 409, "This response was submitted and is waiting for your teacher"],
    [{ ok: false, status: 400, reason: "empty_response" }, 400, "Write something before submitting"],
  ];
  for (const [next, status, message] of cases) {
    failure = next;
    const res = await r.submit.POST(jsonPost(`${WRITE}/submit`, { assignmentId: null, body: "x" }), article);
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: string }).error, message);
  }
  failure = { ok: false, status: 404, reason: "not_found" };
  assert.equal((await r.write.GET(getReq(WRITE), article)).status, 404);
  assert.equal((await r.write.PUT(put({ assignmentId: null, body: "x" }), article)).status, 404);
});

test("teachers list and review assignment responses; reviews are audited by id", async () => {
  const r = await routes();
  const list = await r.list.GET(getReq("http://test/api/assignments/as1/submissions"), withParams({ id: "as1" }));
  assert.deepEqual(await list.json(), { assignment: { id: "as1" }, submissions: [] });

  const review = await r.review.POST(
    jsonPost("http://test/api/write-submissions/w1/review", {
      action: "return",
      rubricScores: { claim: 2 },
      feedback: "More evidence",
    }),
    withParams({ id: "w1" }),
  );
  assert.deepEqual(await review.json(), { submission: { id: "w1", status: "GRADED" } });
  assert.deepEqual(calls.at(-1), { fn: "review", args: ["w1", { action: "return", rubricScores: { claim: 2 }, feedback: "More evidence" }] });
  assert.equal(auditInputs[0]?.targetType, "write_submission");
  assert.equal(auditInputs[0]?.targetId, "w1");
  assert.equal(auditInputs[0]?.action, "write_submission.grade");

  for (const body of [
    { action: "publish", rubricScores: {} },
    { action: "grade", rubricScores: [1, 2] },
    { action: "grade" },
  ]) {
    assert.equal((await r.review.POST(jsonPost("http://test/api/write-submissions/w1/review", body), withParams({ id: "w1" }))).status, 400);
  }

  failure = { ok: false, status: 403, reason: "forbidden" };
  assert.equal((await r.list.GET(getReq("http://test/api/assignments/as1/submissions"), withParams({ id: "as1" }))).status, 403);
  failure = { ok: false, status: 409, reason: "not_reviewable" };
  const blocked = await r.review.POST(
    jsonPost("http://test/api/write-submissions/w1/review", { action: "grade", rubricScores: {} }),
    withParams({ id: "w1" }),
  );
  assert.equal(blocked.status, 409);
  assert.equal(((await blocked.json()) as { error: string }).error, "Only submitted responses can be reviewed");
});
