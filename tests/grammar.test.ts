/**
 * Tests for src/lib/grammar.ts (issue #114)
 *
 * Runs on Node's built-in test runner. Uses module mocking via
 * --experimental-test-module-mocks so no DB or network is touched.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

// Mutable state read by the mock factories
let aiConfigured = false;
let aiReply: string | null = null;
const grammarRows = new Map<string, { explanation: string }>();
let upsertCount = 0;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async () => aiReply,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        grammarExplanation: {
          findUnique: async (args: {
            where: { articleId_phrase: { articleId: string; phrase: string } };
          }) => {
            const key = `${args.where.articleId_phrase.articleId}:${args.where.articleId_phrase.phrase}`;
            return grammarRows.get(key) ?? null;
          },
          upsert: async (args: {
            where: { articleId_phrase: { articleId: string; phrase: string } };
            create: { articleId: string; phrase: string; explanation: string };
            update: { explanation: string };
          }) => {
            const key = `${args.where.articleId_phrase.articleId}:${args.where.articleId_phrase.phrase}`;
            const row = { explanation: args.create.explanation };
            grammarRows.set(key, row);
            upsertCount++;
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
  grammarRows.clear();
  upsertCount = 0;
});

test("returns fallback when AI is not configured", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = false;
  const result = await explainGrammar("article-1", "give up", "", "B1");
  assert.equal(result.fallback, true);
  assert.equal(result.explanation, null);
  assert.equal(upsertCount, 0);
});

test("returns fallback when AI returns null", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = true;
  aiReply = null;
  const result = await explainGrammar("article-1", "fall through", "The deal fell through.", "B2");
  assert.equal(result.fallback, true);
  assert.equal(result.explanation, null);
  assert.equal(upsertCount, 0);
});

test("generates and caches explanation when AI is configured", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = true;
  aiReply = "'Give up' is a phrasal verb meaning to stop trying. Example: She gave up learning piano.";
  const result = await explainGrammar("article-1", "give up", "He decided to give up smoking.", "B1");
  assert.equal(result.fallback, false);
  assert.equal(result.explanation, aiReply);
  assert.equal(upsertCount, 1);
});

test("returns cached explanation without calling AI again", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = true;
  aiReply = "'Give up' is a phrasal verb meaning to stop trying.";

  // First call — generates
  await explainGrammar("article-1", "give up", "", "B1");
  assert.equal(upsertCount, 1);

  // Second call — should hit cache
  const result = await explainGrammar("article-1", "give up", "", "B1");
  assert.equal(result.fallback, false);
  assert.equal(upsertCount, 1, "should not upsert again on cache hit");
});

test("normalises phrase casing for cache key", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = true;
  aiReply = "It means to continue.";

  await explainGrammar("article-1", "Carry On", "", "A2");
  assert.equal(upsertCount, 1);

  // Same phrase with different casing — should hit cache
  const result = await explainGrammar("article-1", "carry on", "", "A2");
  assert.equal(result.fallback, false);
  assert.equal(upsertCount, 1, "cache key should be normalised");
});

test("returns fallback for empty phrase", async () => {
  const { explainGrammar } = await import("@/lib/grammar");
  aiConfigured = true;
  aiReply = "some text";
  const result = await explainGrammar("article-1", "   ", "", "B1");
  assert.equal(result.fallback, true);
  assert.equal(upsertCount, 0);
});
