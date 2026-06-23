process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";

let status = "draft";
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
            status = "published";
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
  mock.module("@/lib/tags", {
    namedExports: {
      getOrCreateArticleTags: async () => ({ tags: [{ id: "t1", name: "Metrics", slug: "metrics" }], fallback: false }),
    },
  });
  mock.module("@/lib/translation", {
    namedExports: {
      getOrCreateTranslation: async () => ({ languageLabel: "Spanish", fallback: false }),
    },
  });
  mock.module("@/lib/speech", {
    namedExports: {
      getOrCreateArticleSpeech: async () => ({ words: [{ textOffset: 0, length: 7, start: 0, end: 1 }], fallback: false }),
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {},
    },
  });
});

beforeEach(() => {
  status = "draft";
  updated = false;
  resetMetrics();
});

test("processArticle records content processing metrics without article ids", async () => {
  const { processArticle } = (await import("@/lib/processor")) as typeof import("@/lib/processor");
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
