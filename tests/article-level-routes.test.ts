/**
 * HTTP route tests for reading levels (#1303): admin level authoring and
 * generation, the reader levels list, and level-scoped quiz routes. Domain
 * modules are mocked (PostgreSQL behaviour lives in tests/db/article-levels.test.ts).
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/errors/api-error";
import { type RouteHandler, getReq, jsonPost, makeJsonRequest, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let articleReadable = true;
let aiConfigured = true;
let articleExists = true;
let saveResult: unknown = { ok: true, level: { levelKey: "B1", wordCount: 120, lexileApprox: 840 } };
let deleted = true;
let calls: Array<{ fn: string; args: unknown[] }> = [];
let audits: Array<Record<string, unknown>> = [];
let quizResult: unknown = { articleId: "a1", levelKey: "B1", questions: [], fallback: true };

before(() => {
  mock.module("@/lib/api-auth", { namedExports: fullAuthExports(() => authState) });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminArticleLevelSave: "admin.article.level_save",
        adminArticleLevelDelete: "admin.article.level_delete",
        adminArticleLevelGenerate: "admin.article.level_generate",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: Record<string, unknown>) => {
        audits.push(input);
      },
      tryRecordAuditLog: async (input: Record<string, unknown>) => {
        audits.push(input);
      },
    },
  });
  mock.module("@/lib/reader/route-guard", {
    namedExports: {
      requireReadableArticle: async (id: string) => {
        if (!articleReadable) throw new ApiError(404, "Article not found");
        return { article: { id, title: "Reefs" }, context: {} };
      },
      requireReadableArticleForAI: async (id: string) => {
        if (!articleReadable) throw new ApiError(404, "Article not found");
        return { article: { id, title: "Reefs" }, context: { role: "Reader" } };
      },
    },
  });
  mock.module("@/lib/article-levels/authoring", {
    namedExports: {
      saveArticleLevel: async (
        articleId: string,
        level: string,
        input: unknown,
        opts: { actorId: string; source: string; audit?: (level: unknown) => Record<string, unknown> },
      ) => {
        calls.push({ fn: "save", args: [articleId, level, input, { actorId: opts.actorId, source: opts.source }] });
        const result = saveResult as { ok: boolean; level?: unknown };
        if (result.ok && opts.audit) audits.push(opts.audit(result.level));
        return saveResult;
      },
      deleteArticleLevel: async (articleId: string, level: string, audit?: () => Record<string, unknown>) => {
        calls.push({ fn: "delete", args: [articleId, level] });
        if (deleted && audit) audits.push(audit());
        return deleted;
      },
    },
  });
  mock.module("@/lib/article-levels/variants", {
    namedExports: {
      LEVEL_TITLE_MAX_LENGTH: 300,
      LEVEL_TEXT_MAX_LENGTH: 60_000,
      levelKeysForArticles: async (ids: string[]) => new Map(ids.map((id) => [id, ["B1", "original"]])),
      getArticleLevelVariant: async (_articleId: string, level: string) =>
        level === "A2" ? { levelKey: "A2", title: "T", content: "<p>x</p>", wordCount: 1, lexileApprox: 500, cefrLevel: "A2" } : null,
    },
  });
  mock.module("@/lib/jobs/enqueue", {
    namedExports: {
      enqueueLevelAdapt: async (articleId: string, level: string, opts: unknown) => {
        calls.push({ fn: "enqueue", args: [articleId, level, opts] });
        return { id: "job-1" };
      },
    },
  });
  mock.module("@/lib/ai", { namedExports: { isAiConfigured: () => aiConfigured } });
  mock.module("@/lib/prisma", {
    namedExports: { prisma: { article: { findUnique: async () => (articleExists ? { id: "a1" } : null) } } },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async (articleId: string, _ctx: unknown, level: string) => {
        calls.push({ fn: "quiz", args: [articleId, level] });
        return quizResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleReadable = true;
  aiConfigured = true;
  articleExists = true;
  saveResult = { ok: true, level: { levelKey: "B1", wordCount: 120, lexileApprox: 840 } };
  deleted = true;
  calls = [];
  audits = [];
  quizResult = { articleId: "a1", levelKey: "B1", questions: [], fallback: true };
});

async function routes() {
  return {
    level: (await import("@/app/api/admin/articles/[id]/levels/[level]/route")) as { PUT: RouteHandler; DELETE: RouteHandler },
    generate: (await import("@/app/api/admin/articles/[id]/levels/[level]/generate/route")) as { POST: RouteHandler },
    levels: (await import("@/app/api/reader/[id]/levels/route")) as { GET: RouteHandler },
    quiz: (await import("@/app/api/reader/[id]/quiz/route")) as { POST: RouteHandler },
  };
}

const LEVEL = "http://test/api/admin/articles/a1/levels/B1";
const b1 = withParams({ id: "a1", level: "B1" });

test("admin level routes require content moderation", async () => {
  const r = await routes();
  for (const state of ["unauth", "forbidden"] as const) {
    authState = state;
    const expected = state === "unauth" ? 401 : 403;
    assert.equal((await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: "T", text: "x" }), b1)).status, expected);
    assert.equal((await r.level.DELETE(makeJsonRequest(LEVEL, "DELETE"), b1)).status, expected);
    assert.equal((await r.generate.POST(jsonPost(`${LEVEL}/generate`, {}), b1)).status, expected);
  }
  assert.deepEqual(calls, []);
});

test("admins save and delete levels; audits carry metrics, never text", async () => {
  const r = await routes();
  const saved = await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: " Reefs ", text: "Secret paragraph text." }), b1);
  assert.equal(saved.status, 200);
  assert.deepEqual(calls[0], {
    fn: "save",
    args: ["a1", "B1", { title: "Reefs", text: "Secret paragraph text." }, { actorId: "admin-1", source: "manual" }],
  });
  assert.equal(audits[0].action, "admin.article.level_save");
  assert.deepEqual(audits[0].metadata, { level: "B1", wordCount: 120, lexileApprox: 840 });
  assert.equal(JSON.stringify(audits).includes("Secret"), false);

  saveResult = { ok: false, status: 400, reason: "empty_level" };
  const empty = await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: "T", text: " x " }), b1);
  assert.equal(empty.status, 400);
  saveResult = { ok: false, status: 404, reason: "not_found" };
  assert.equal((await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: "T", text: "x" }), b1)).status, 404);

  assert.equal((await r.level.DELETE(makeJsonRequest(LEVEL, "DELETE"), b1)).status, 200);
  assert.equal(audits.at(-1)?.action, "admin.article.level_delete");
  deleted = false;
  assert.equal((await r.level.DELETE(makeJsonRequest(LEVEL, "DELETE"), b1)).status, 404);

  calls = [];
  assert.equal((await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: "T" }), b1)).status, 400);
  assert.equal(
    (await r.level.PUT(makeJsonRequest(LEVEL, "PUT", { title: "T", text: "x" }), withParams({ id: "a1", level: "original" }))).status,
    400,
    "the original level isn't editable here",
  );
  assert.deepEqual(calls, []);
});

test("generation queues a LEVEL_ADAPT job or asks for manual entry without AI", async () => {
  const r = await routes();
  const queued = await r.generate.POST(jsonPost(`${LEVEL}/generate`, { replace: true }), b1);
  assert.equal(queued.status, 202);
  assert.deepEqual(await queued.json(), { queued: true, jobId: "job-1" });
  assert.deepEqual(calls.at(-1), { fn: "enqueue", args: ["a1", "B1", { actorId: "admin-1", replace: true }] });
  assert.deepEqual(audits.at(-1)?.metadata, { level: "B1", jobId: "job-1", replace: true });

  aiConfigured = false;
  const manual = await r.generate.POST(jsonPost(`${LEVEL}/generate`, {}), b1);
  assert.equal(manual.status, 503);
  assert.match(((await manual.json()) as { error: string }).error, /add this level manually/);
  articleExists = false;
  assert.equal((await r.generate.POST(jsonPost(`${LEVEL}/generate`, {}), b1)).status, 404);
});

test("readers list levels and fetch level-scoped quizzes", async () => {
  const r = await routes();
  const levels = await r.levels.GET(getReq("http://test/api/reader/a1/levels"), withParams({ id: "a1" }));
  assert.deepEqual(await levels.json(), { levels: ["B1", "original"] });

  const quiz = await r.quiz.POST(jsonPost("http://test/api/reader/a1/quiz?level=B1", {}), withParams({ id: "a1" }));
  assert.equal(quiz.status, 200);
  assert.deepEqual(calls.at(-1), { fn: "quiz", args: ["a1", "B1"] });
  await r.quiz.POST(jsonPost("http://test/api/reader/a1/quiz", {}), withParams({ id: "a1" }));
  assert.deepEqual(calls.at(-1)?.args, ["a1", "original"]);
  assert.equal((await r.quiz.POST(jsonPost("http://test/api/reader/a1/quiz?level=Z9", {}), withParams({ id: "a1" }))).status, 400);
  quizResult = null;
  assert.equal((await r.quiz.POST(jsonPost("http://test/api/reader/a1/quiz?level=C1", {}), withParams({ id: "a1" }))).status, 404);

  articleReadable = false;
  assert.equal((await r.levels.GET(getReq("http://test/api/reader/a1/levels"), withParams({ id: "a1" }))).status, 404);
});

test("requireArticleLevel resolves the original and rejects missing levels", async () => {
  const { requireArticleLevel } = await import("@/lib/article-levels/http");
  assert.equal(await requireArticleLevel("a1", "original"), null);
  await assert.rejects(requireArticleLevel("a1", "B1"), { name: "ApiError", status: 404 });
  assert.equal((await requireArticleLevel("a1", "A2"))?.title, "T");
});
