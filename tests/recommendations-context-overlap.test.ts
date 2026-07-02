process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        wordMastery: {
          aggregate: async () => ({ _avg: { familiarity: 0.2 }, _count: { _all: 3 } }),
          findMany: async () => [
            { sourceArticleIds: ["a1", "a1", "outside"] },
            { sourceArticleIds: ["a1", "a2"] },
          ],
        },
        readingProgress: { findMany: async () => [] },
        articleMastery: { findMany: async () => [] },
      },
    },
  });
  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => ({ englishLevel: "B1", topics: ["science"] }),
      parseTopics: (topics: unknown) => (Array.isArray(topics) ? topics : []),
    },
  });
  mock.module("@/lib/leveling", {
    namedExports: {
      getAdaptiveLevelRecommendation: async () => null,
    },
  });
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      getSkillProfile: async () => ({
        skills: [],
        overallConfidence: 0,
        totalEvidence: 0,
        weakest: null,
        strongest: null,
      }),
    },
  });
});

test("buildRecommendationContext counts distinct weak-word article overlaps per candidate", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  const ctx = await buildRecommendationContext("user-1", ["a1", "a2"]);

  assert.equal(ctx.weakWordArticleIds.get("a1"), 2);
  assert.equal(ctx.weakWordArticleIds.get("a2"), 1);
  assert.equal(ctx.weakWordArticleIds.has("outside"), false);
});
