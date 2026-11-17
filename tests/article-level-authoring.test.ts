/**
 * Unit tests for reading-level authoring and AI adaptation (#1303). Prisma,
 * the AI facade, and the article loader are mocked; PostgreSQL behaviour lives
 * in tests/db/article-levels.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type LevelRow = { levelKey: string; title: string; content: string; wordCount: number; lexileApprox: number | null; cefrLevel: string | null; source: string; updatedAt: Date };

let aiConfigured = true;
let completion: string | null = null;
let completionCalls: Array<{ messages: Array<{ role: string; content: string }>; options: Record<string, unknown> }> = [];
let articleText: { title: string; content: string } | null = { title: "Reef news", content: "<p>Coral reefs recover.</p>" };
let articleExists = true;
let levels = new Map<string, LevelRow>();
let quizDeletes: unknown[] = [];

function key(where: { articleId_levelKey_language: { levelKey: string } }) {
  return where.articleId_levelKey_language.levelKey;
}

const prismaMock = {
  article: { findUnique: async () => (articleExists ? { id: "a1" } : null) },
  articleLevel: {
    findUnique: async ({ where }: { where: { articleId_levelKey_language: { levelKey: string } } }) => levels.get(key(where)) ?? null,
    upsert: async ({ where, create, update }: { where: { articleId_levelKey_language: { levelKey: string } }; create: LevelRow; update: Partial<LevelRow> }) => {
      const existing = levels.get(key(where));
      const row = { ...(existing ?? create), ...(existing ? update : {}), updatedAt: new Date() } as LevelRow;
      levels.set(key(where), row);
      return row;
    },
    deleteMany: async ({ where }: { where: { levelKey: string } }) => {
      const had = levels.delete(where.levelKey);
      return { count: had ? 1 : 0 };
    },
  },
  quizQuestion: {
    deleteMany: async (args: unknown) => {
      quizDeletes.push(args);
      return { count: 0 };
    },
  },
  $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prismaMock) : Promise.all(arg as unknown[])),
};

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      chatComplete: async (messages: Array<{ role: string; content: string }>, options: Record<string, unknown>) => {
        completionCalls.push({ messages, options });
        return completion;
      },
    },
  });
  mock.module("@/lib/difficulty", {
    namedExports: {
      deterministicDifficulty: (content: string) => ({
        level: "A2",
        lexileApprox: 600,
        metrics: { wordCount: content.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length },
      }),
    },
  });
  mock.module("@/lib/article-library/policy", {
    namedExports: { loadAiProcessableArticleText: async () => articleText },
  });
});

beforeEach(() => {
  aiConfigured = true;
  completion = null;
  completionCalls = [];
  articleText = { title: "Reef news", content: "<p>Coral reefs recover.</p>" };
  articleExists = true;
  levels = new Map();
  quizDeletes = [];
});

const authoring = () => import("@/lib/article-levels/authoring");

test("parseLevelAdaptation accepts a headline plus paragraphs", async () => {
  const { parseLevelAdaptation } = await authoring();
  assert.deepEqual(parseLevelAdaptation('```json\n["Reefs  can heal", "Reefs grow back.", "", "Water must cool."]\n```'), {
    title: "Reefs can heal",
    paragraphs: ["Reefs grow back.", "Water must cool."],
  });
  for (const bad of ["no json", '["only title"]', '["t", 3]', `["${"x".repeat(301)}", "p"]`, '[" ", "p"]', '["t", " "]']) {
    assert.equal(parseLevelAdaptation(bad), null, bad);
  }
});

test("saveArticleLevel measures the text and clears the level quiz when it changes", async () => {
  const { saveArticleLevel } = await authoring();
  const first = await saveArticleLevel("a1", "B1", { title: " Reefs heal ", text: "Reefs grow back.\n\nWater must cool." }, { actorId: "u1", source: "manual" });
  assert.ok(first.ok);
  assert.equal(first.level.levelKey, "B1");
  assert.equal(first.level.title, "Reefs heal");
  assert.ok(first.level.wordCount > 0);
  assert.equal(typeof first.level.lexileApprox, "number");
  assert.deepEqual(quizDeletes, [], "a new level has no quiz to clear");

  await saveArticleLevel("a1", "B1", { title: "Reefs heal", text: "Reefs grow back.\n\nWater must cool." }, { actorId: "u1", source: "manual" });
  assert.deepEqual(quizDeletes, [], "unchanged text keeps the quiz");
  await saveArticleLevel("a1", "B1", { title: "Reefs heal", text: "New text." }, { actorId: "u1", source: "manual" });
  assert.deepEqual(quizDeletes, [{ where: { articleId: "a1", levelKey: "B1" } }]);

  assert.deepEqual(await saveArticleLevel("a1", "A2", { title: "T", text: "  \n\n " }, { actorId: null, source: "manual" }), {
    ok: false,
    status: 400,
    reason: "empty_level",
  });
  assert.deepEqual(await saveArticleLevel("a1", "A2", { title: "  ", text: "x" }, { actorId: null, source: "manual" }), {
    ok: false,
    status: 400,
    reason: "empty_level",
  });
  articleExists = false;
  assert.deepEqual(await saveArticleLevel("gone", "A2", { title: "T", text: "x" }, { actorId: null, source: "manual" }), {
    ok: false,
    status: 404,
    reason: "not_found",
  });
});

test("deleteArticleLevel removes the level and its quiz", async () => {
  const { saveArticleLevel, deleteArticleLevel } = await authoring();
  await saveArticleLevel("a1", "C1", { title: "T", text: "Text." }, { actorId: null, source: "manual" });
  assert.equal(await deleteArticleLevel("a1", "C1"), true);
  assert.equal(await deleteArticleLevel("a1", "C1"), false);
  assert.deepEqual(quizDeletes.at(-1), { where: { articleId: "a1", levelKey: "C1" } });
});

test("adaptArticleLevel generates, skips, and fails gracefully", async () => {
  const { adaptArticleLevel } = await authoring();

  completion = '["Reefs can heal", "Reefs grow back when water cools."]';
  const generated = await adaptArticleLevel("a1", "A2", { actorId: "admin" });
  assert.equal(generated.status, "generated");
  assert.equal(levels.get("A2")?.source, "ai");
  assert.equal(completionCalls[0].options.feature, "level-adapt");
  assert.match(completionCalls[0].messages[0].content, /CEFR A2 reader \(about 600L\)/);
  assert.match(completionCalls[0].messages[1].content, /Coral reefs recover/);

  assert.deepEqual(await adaptArticleLevel("a1", "A2"), { status: "skipped", reason: "already_exists" });
  assert.equal((await adaptArticleLevel("a1", "A2", { replace: true })).status, "generated");

  aiConfigured = false;
  assert.deepEqual(await adaptArticleLevel("a1", "B2"), { status: "skipped", reason: "provider_unconfigured" });
  aiConfigured = true;

  completion = null;
  assert.deepEqual(await adaptArticleLevel("a1", "B2"), { status: "failed", reason: "provider_error" });
  completion = "not json";
  assert.deepEqual(await adaptArticleLevel("a1", "B2"), { status: "failed", reason: "validation_failed" });
  articleExists = false;
  completion = '["T", "P."]';
  assert.deepEqual(await adaptArticleLevel("a1", "B2"), { status: "failed", reason: "validation_failed" });
  articleText = null;
  assert.deepEqual(await adaptArticleLevel("a1", "B2"), { status: "failed", reason: "article_not_found" });
});
