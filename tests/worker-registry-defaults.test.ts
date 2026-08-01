process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { CrawlCandidateStatus } from "@prisma/client";
import { mock, test } from "node:test";

let candidateQuery: Record<string, unknown> | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      crawlCandidate: {
        findUnique: async (query: Record<string, unknown>) => {
          candidateQuery = query;
          return {
            id: "candidate-1",
            status: CrawlCandidateStatus.DISCOVERED,
            observedInBaseline: false,
            articleId: null,
            ingestAttemptCount: 0,
            firstIngestAttemptAt: null,
          };
        },
      },
    },
  },
});
mock.module("@/lib/push/scheduler", {
  namedExports: {
    sendPushReminderForUser: async () => ({
      userId: "user-1",
      dueCount: 0,
      sent: 0,
      skipped: true,
      suppressed: false,
    }),
  },
});

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test("default worker registry loads candidate jobs and dispatches legacy article jobs", async () => {
  const { createDefaultRegistry } = await import("@/lib/worker/registry");
  const { JobType } = await import("@/lib/jobs");
  const processedArticleIds: string[] = [];
  const registry = createDefaultRegistry(async (articleId) => {
    processedArticleIds.push(articleId);
    return {
      articleId,
      title: "Synthetic article",
      ok: true,
      published: false,
      steps: [],
    };
  });
  const handler = registry.get(JobType.ARTICLE_INGEST);
  assert.ok(handler);

  await handler(
    {
      id: "candidate-job",
      payload: { candidateId: "candidate-1", processingVersion: 1 },
    } as never,
    { logger },
  );
  assert.deepEqual(candidateQuery, {
    where: { id: "candidate-1" },
    select: {
      id: true,
      status: true,
      observedInBaseline: true,
      articleId: true,
      ingestAttemptCount: true,
      firstIngestAttemptAt: true,
    },
  });

  await handler(
    { id: "legacy-job", payload: { articleId: "article-1" } } as never,
    { logger },
  );
  assert.deepEqual(processedArticleIds, ["article-1"]);
});
