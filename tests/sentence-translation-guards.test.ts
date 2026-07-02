process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

const MAX_SENTENCE_CHARS = 1000;

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: {
      SYSTEM_ARTICLE_CONTEXT: { kind: "system" },
      isArticleOperator: () => false,
      getAiProcessableArticleById: async () => null,
    },
  });
  mock.module("@/lib/ai/cache", {
    namedExports: {
      getOrCreateArticleAi: async () => {
        throw new Error("article cache should not be reached");
      },
      getOrCreateSelectionAi: async () => {
        throw new Error("selection cache should not be reached");
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => ({ id: "article-1" }),
        },
      },
    },
  });
});

test("translateSentence returns fallback for empty, overlong, or unsupported inputs", async () => {
  const { translateSentence } = await import("@/lib/sentence-translation");

  assert.deepEqual(await translateSentence("a1", "   ", "es"), {
    translation: null,
    fallback: true,
  });
  assert.deepEqual(await translateSentence("a1", "x".repeat(MAX_SENTENCE_CHARS + 1), "es"), {
    translation: null,
    fallback: true,
  });
  assert.deepEqual(await translateSentence("a1", "Hello", "not-a-lang"), {
    translation: null,
    fallback: true,
  });
});

test("translateSentence returns null when a scoped context cannot access the article", async () => {
  const { translateSentence } = await import("@/lib/sentence-translation");

  assert.equal(await translateSentence("a1", "Hello world", "es", { userId: "u1" } as never), null);
});
