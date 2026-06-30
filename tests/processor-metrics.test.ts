process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";
import { ArticleStatus, TagScope } from "@prisma/client";

let status: ArticleStatus = ArticleStatus.DRAFT;
let updated = false;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findFirst: async () => ({
            id: "secret-article-id-123456",
            title: "Metrics article",
            status,
            difficulty: null,
            _count: { tags: 0, vocabulary: 0, quizQuestions: 0 },
            translations: [],
            speech: null,
          }),
          update: async () => {
            updated = true;
            status = ArticleStatus.PUBLISHED;
            return {};
          },
          findMany: async () => [],
        },
      },
    },
  });
  mock.module("@/lib/difficulty", {
    namedExports: {
      getOrCreateArticleDifficulty: async () => ({ level: "B1", source: "heuristic" }),
    },
  });
  mock.module("@/lib/vocabulary", {
    namedExports: {
      getOrCreateArticleVocabulary: async () => ({ items: [{ word: "metric" }], fallback: false }),
    },
  });
  mock.module("@/lib/quiz", {
    namedExports: {
      getOrCreateArticleQuiz: async () => ({ questions: [{ question: "Q" }], fallback: false }),
    },
  });
  mock.module("@/lib/article-library/collections/tags", {
    namedExports: {
      getOrCreateArticleTags: async () => ({
        tags: [{ id: "t1", name: "Metrics", slug: "metrics", scope: TagScope.PUBLIC }],
        fallback: false,
      }),
    },
  });
  mock.module("@/lib/translation", {
    namedExports: {
      getOrCreateTranslation: async () => ({ languageLabel: "Spanish", fallback: false }),
    },
  });
  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => ({
        words: [{ word: "metrics", startMs: 0, endMs: 1000 }],
        fallback: false,
      }),
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {},
    },
  });
});

beforeEach(() => {
  status = ArticleStatus.DRAFT;
  updated = false;
  resetMetrics();
});

test("processArticle records content processing metrics without article ids", async () => {
  const { processArticle } = (await import("@/lib/processing/processor")) as typeof import("@/lib/processing/processor");
  const result = await processArticle("secret-article-id-123456", { translateLangs: ["es"], tts: true });

  assert.equal(result?.ok, true);
  assert.equal(result?.published, true);
  assert.equal(updated, true);

  const snapshot = getMetricsSnapshot();
  const runMetric = snapshot.counters.find(
    (point) =>
      point.name === "readwise_content_processing_runs_total" &&
      point.labels.outcome === "success" &&
      point.labels.published === "true",
  );
  assert.equal(runMetric?.value, 1);
  const publishStep = snapshot.counters.find(
    (point) =>
      point.name === "readwise_content_processing_steps_total" &&
      point.labels.step === "publish" &&
      point.labels.status === "generated",
  );
  assert.equal(publishStep?.value, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-article-id-123456/);
});
