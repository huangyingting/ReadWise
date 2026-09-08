process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";

import { migrateReaderDataInTx } from "@/lib/scraper/incremental/canonical-conflict-migrate";

test("canonical migration preserves a loser highlight when the survivor note differs", async () => {
  const deleted: string[] = [];
  const updated: string[] = [];
  const emptyScoped = {
    findMany: async () => [],
    update: async () => ({}),
    delete: async () => ({}),
  };
  const tx = {
    article: {
      findUnique: async () => ({ content: "<p>hello world</p>" }),
    },
    readingProgress: emptyScoped,
    readingListItem: emptyScoped,
    articleMastery: emptyScoped,
    articleDifficultyFeedback: emptyScoped,
    highlight: {
      findMany: async (args: { where: { articleId: string | { in: string[] } } }) =>
        typeof args.where.articleId === "string"
          ? [
              {
                userId: "user-1",
                startOffset: 0,
                endOffset: 5,
                note: "survivor note",
              },
            ]
          : [
              {
                id: "loser-highlight",
                userId: "user-1",
                quote: "hello",
                startOffset: 0,
                endOffset: 5,
                prefix: null,
                suffix: " world",
                note: "loser note",
              },
            ],
      delete: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return {};
      },
      update: async ({ where }: { where: { id: string } }) => {
        updated.push(where.id);
        return {};
      },
    },
    tutorMessage: { updateMany: async () => ({ count: 0 }) },
    quizAttempt: { updateMany: async () => ({ count: 0 }) },
    pronunciationAttempt: { updateMany: async () => ({ count: 0 }) },
  } as unknown as Prisma.TransactionClient;

  const result = await migrateReaderDataInTx(tx, {
    loserArticleIds: ["loser-article"],
    survivingArticleId: "survivor-article",
    deriveReaderText: () => "hello world",
    now: new Date("2026-07-22T00:00:00Z"),
  });

  assert.deepEqual(result.highlights, {
    repointed: 0,
    merged: 0,
    skipped: 1,
  });
  assert.deepEqual(deleted, []);
  assert.deepEqual(updated, []);
});
