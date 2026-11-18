/**
 * HTTP route tests for the classroom annotations API (#1307). Domain
 * commands and the article read guard are mocked (real-database behaviour
 * lives in tests/db/annotations.test.ts); these cover auth, validation,
 * status mapping, article access, and audit wiring.
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
  mock.module("@/lib/article-levels/variants", {
    namedExports: {
      getArticleLevelVariant: async (_articleId: string, level: string) =>
        level === "B1" ? { levelKey: "B1", title: "T", content: "<p>x</p>", wordCount: 1, lexileApprox: 800, cefrLevel: "B1" } : null,
    },
  });
  mock.module("@/lib/classroom/annotations", {
    namedExports: {
      getReaderAnnotationContext: async (viewer: { id: string }, articleId: string, level: string) => {
        calls.push({ fn: "context", args: [viewer.id, articleId, level] });
        return { teaching: [], learning: [], guides: [], responses: [] };
      },
      getAssignmentAnnotationReview: async (assignmentId: string) => {
        calls.push({ fn: "review", args: [assignmentId] });
        return failure ?? { ok: true, review: { assignment: { id: assignmentId }, guides: [], evidence: [] } };
      },
      createGuidedAnnotation: async (_viewer: unknown, assignmentId: string, input: unknown, audit: AuditFactory) => {
        calls.push({ fn: "create", args: [assignmentId, input] });
        auditInputs.push(audit({ action: "assignment_annotation.create", targetId: "g1", metadata: { assignmentId } }));
        return failure ?? { ok: true, guide: { id: "g1" } };
      },
      updateGuidedAnnotation: async (_viewer: unknown, id: string, prompt: string, audit: AuditFactory) => {
        calls.push({ fn: "update", args: [id, prompt] });
        auditInputs.push(audit({ action: "assignment_annotation.update", targetId: id, metadata: {} }));
        return failure ?? { ok: true, guide: { id, prompt } };
      },
      deleteGuidedAnnotation: async (_viewer: unknown, id: string, audit: AuditFactory) => {
        calls.push({ fn: "delete", args: [id] });
        auditInputs.push(audit({ action: "assignment_annotation.delete", targetId: id, metadata: {} }));
        return failure ?? { ok: true };
      },
      submitAnnotationResponse: async (viewer: { id: string }, assignmentId: string, input: unknown) => {
        calls.push({ fn: "respond", args: [viewer.id, assignmentId, input] });
        return failure ?? { ok: true, response: { id: "r1" } };
      },
      deleteAnnotationResponse: async (viewer: { id: string }, id: string) => {
        calls.push({ fn: "withdraw", args: [viewer.id, id] });
        return failure ?? { ok: true };
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
    reader: (await import("@/app/api/reader/[id]/annotations/route")) as { GET: RouteHandler },
    guides: (await import("@/app/api/assignments/[id]/annotations/route")) as { GET: RouteHandler; POST: RouteHandler },
    guide: (await import("@/app/api/assignment-annotations/[id]/route")) as { PATCH: RouteHandler; DELETE: RouteHandler },
    respond: (await import("@/app/api/assignments/[id]/annotation-responses/route")) as { POST: RouteHandler },
    response: (await import("@/app/api/annotation-responses/[id]/route")) as { DELETE: RouteHandler },
  };
}

const READER = "http://test/api/reader/a1/annotations";
const GUIDES = "http://test/api/assignments/as1/annotations";
const RESPOND = "http://test/api/assignments/as1/annotation-responses";
const GUIDE = "http://test/api/assignment-annotations/g1";
const RESPONSE = "http://test/api/annotation-responses/r1";
const assignment = withParams({ id: "as1" });
const anchor = { quote: "reefs recover", startOffset: 10, endOffset: 23, prefix: "Some ", suffix: " slowly", levelKey: "B1" };

test("annotation routes require a session", async () => {
  authState = "unauth";
  const r = await routes();
  assert.equal((await r.reader.GET(getReq(READER), withParams({ id: "a1" }))).status, 401);
  assert.equal((await r.guides.GET(getReq(GUIDES), assignment)).status, 401);
  assert.equal((await r.guides.POST(jsonPost(GUIDES, { ...anchor, prompt: "Why?" }), assignment)).status, 401);
  assert.equal((await r.guide.PATCH(makeJsonRequest(GUIDE, "PATCH", { prompt: "x" }), withParams({ id: "g1" }))).status, 401);
  assert.equal((await r.guide.DELETE(makeJsonRequest(GUIDE, "DELETE"), withParams({ id: "g1" }))).status, 401);
  assert.equal((await r.respond.POST(jsonPost(RESPOND, { body: "x" }), assignment)).status, 401);
  assert.equal((await r.response.DELETE(makeJsonRequest(RESPONSE, "DELETE"), withParams({ id: "r1" }))).status, 401);
  assert.deepEqual(calls, []);
});

test("the reader context requires a readable article", async () => {
  const r = await routes();
  const res = await r.reader.GET(getReq(READER), withParams({ id: "a1" }));
  assert.deepEqual(await res.json(), { teaching: [], learning: [], guides: [], responses: [] });
  assert.deepEqual(calls.at(-1), { fn: "context", args: ["user-1", "a1", undefined] });

  articleReadable = false;
  calls = [];
  assert.equal((await r.reader.GET(getReq(READER), withParams({ id: "a1" }))).status, 404);
  assert.deepEqual(calls, []);
});

test("teachers create, edit, and delete prompts; each change is audited by id", async () => {
  const r = await routes();
  const created = await r.guides.POST(jsonPost(GUIDES, { ...anchor, prompt: "  Why does this matter?  " }), assignment);
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { guide: { id: "g1" } });
  assert.deepEqual(calls.at(-1), { fn: "create", args: ["as1", { ...anchor, prompt: "Why does this matter?" }] });

  const updated = await r.guide.PATCH(makeJsonRequest(GUIDE, "PATCH", { prompt: "New prompt" }), withParams({ id: "g1" }));
  assert.deepEqual(await updated.json(), { guide: { id: "g1", prompt: "New prompt" } });
  const deleted = await r.guide.DELETE(makeJsonRequest(GUIDE, "DELETE"), withParams({ id: "g1" }));
  assert.deepEqual(await deleted.json(), { ok: true });

  assert.deepEqual(
    auditInputs.map((input) => [input.action, input.targetType, input.targetId]),
    [
      ["assignment_annotation.create", "assignment_annotation", "g1"],
      ["assignment_annotation.update", "assignment_annotation", "g1"],
      ["assignment_annotation.delete", "assignment_annotation", "g1"],
    ],
  );

  const review = await r.guides.GET(getReq(GUIDES), assignment);
  assert.deepEqual(await review.json(), { assignment: { id: "as1" }, guides: [], evidence: [] });
});

test("prompt and response bodies are validated", async () => {
  const r = await routes();
  for (const body of [
    { ...anchor },
    { ...anchor, prompt: "   " },
    { ...anchor, prompt: "x".repeat(1001) },
    { ...anchor, quote: "", prompt: "Why?" },
    { ...anchor, startOffset: -1, prompt: "Why?" },
    { ...anchor, prefix: "p".repeat(257), prompt: "Why?" },
    { ...anchor, levelKey: "Z9", prompt: "Why?" },
  ]) {
    assert.equal((await r.guides.POST(jsonPost(GUIDES, body), assignment)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await r.guide.PATCH(makeJsonRequest(GUIDE, "PATCH", {}), withParams({ id: "g1" }))).status, 400);
  for (const body of [{}, { body: "x".repeat(2001) }, { body: "x", anchor: { quote: "q" } }, { body: "x", annotationId: 5 }]) {
    assert.equal((await r.respond.POST(jsonPost(RESPOND, body), assignment)).status, 400);
  }
  assert.deepEqual(calls, []);
});

test("learners reply, share evidence, and withdraw their own responses", async () => {
  const r = await routes();
  const reply = await r.respond.POST(jsonPost(RESPOND, { annotationId: "g1", body: " Because… " }), assignment);
  assert.equal(reply.status, 201);
  assert.deepEqual(await reply.json(), { response: { id: "r1" } });
  assert.deepEqual(calls.at(-1), { fn: "respond", args: ["user-1", "as1", { annotationId: "g1", anchor: undefined, body: "Because…" }] });

  await r.respond.POST(jsonPost(RESPOND, { anchor, body: "" }), assignment);
  assert.deepEqual(calls.at(-1)?.args[2], { annotationId: undefined, anchor, body: "" });

  const withdrawn = await r.response.DELETE(makeJsonRequest(RESPONSE, "DELETE"), withParams({ id: "r1" }));
  assert.deepEqual(await withdrawn.json(), { ok: true });
  assert.deepEqual(calls.at(-1), { fn: "withdraw", args: ["user-1", "r1"] });
});

test("domain failures map to statuses and messages", async () => {
  const r = await routes();
  const cases: Array<[Failure, number, string]> = [
    [{ ok: false, status: 404, reason: "not_found" }, 404, "Not found"],
    [{ ok: false, status: 403, reason: "forbidden" }, 403, "Forbidden"],
    [{ ok: false, status: 409, reason: "archived" }, 409, "Classroom is archived"],
    [{ ok: false, status: 400, reason: "invalid_anchor" }, 400, "Choose a passage from the article"],
    [{ ok: false, status: 400, reason: "empty_response" }, 400, "Write a reply or choose a passage"],
  ];
  for (const [next, status, message] of cases) {
    failure = next;
    const res = await r.respond.POST(jsonPost(RESPOND, { body: "x" }), assignment);
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: string }).error, message);
  }
  failure = { ok: false, status: 403, reason: "forbidden" };
  assert.equal((await r.guides.GET(getReq(GUIDES), assignment)).status, 403);
  assert.equal((await r.guides.POST(jsonPost(GUIDES, { ...anchor, prompt: "Why?" }), assignment)).status, 403);
  assert.equal((await r.guide.PATCH(makeJsonRequest(GUIDE, "PATCH", { prompt: "x" }), withParams({ id: "g1" }))).status, 403);
  assert.equal((await r.guide.DELETE(makeJsonRequest(GUIDE, "DELETE"), withParams({ id: "g1" }))).status, 403);
  failure = { ok: false, status: 404, reason: "not_found" };
  assert.equal((await r.response.DELETE(makeJsonRequest(RESPONSE, "DELETE"), withParams({ id: "r1" }))).status, 404);
});
