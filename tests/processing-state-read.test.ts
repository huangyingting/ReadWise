process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleProcessingStep: {
          upsert: async () => {
            throw new Error("db unavailable");
          },
          findMany: async () => {
            throw new Error("db unavailable");
          },
        },
      },
    },
  });
});

test("getArticleProcessingSteps returns an empty list when the read fails", async () => {
  const { getArticleProcessingSteps } = await import("@/lib/processing/state");

  assert.deepEqual(await getArticleProcessingSteps("article-1"), []);
});

test("finishStep is best-effort when recording completion fails", async () => {
  const { finishStep } = await import("@/lib/processing/state");

  await assert.doesNotReject(() => finishStep("article-1", "quiz", "generated"));
});
