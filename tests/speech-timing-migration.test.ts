process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type SpeechRow = {
  id: string;
  articleId: string;
  words: unknown;
};

let rows: SpeechRow[] = [];
let updates: Array<{ where: { id: string }; data: { words: unknown } }> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: {
          findMany: async () => rows,
          update: async (args: { where: { id: string }; data: { words: unknown } }) => {
            updates.push(args);
            return {};
          },
        },
      },
    },
  });
});

beforeEach(() => {
  rows = [];
  updates = [];
});

test("migrateArticleSpeechTimingsToV2 converts legacy arrays and skips current payloads", async () => {
  const { migrateArticleSpeechTimingsToV2 } = await import("@/lib/speech/timing-migration");
  rows = [
    {
      id: "legacy",
      articleId: "a1",
      words: [
        { word: "world", offset: 500, duration: 200, textOffset: 6, wordLength: 5 },
        { word: "Hello", offset: 0, duration: 400, textOffset: 0, wordLength: 5 },
      ],
    },
    {
      id: "current",
      articleId: "a2",
      words: {
        version: 2,
        provider: "azure",
        timeUnit: "ms",
        textUnit: "utf16",
        words: ["current"],
        startMs: [0],
        endMs: [100],
      },
    },
  ];

  const result = await migrateArticleSpeechTimingsToV2({ provider: "azure" });

  assert.deepEqual(result, {
    scanned: 2,
    migrated: 1,
    skippedCurrent: 1,
    failed: 0,
  });
  assert.deepEqual(updates, [
    {
      where: { id: "legacy" },
      data: {
        words: {
          version: 2,
          provider: "azure",
          timeUnit: "ms",
          textUnit: "utf16",
          words: ["Hello", "world"],
          startMs: [0, 500],
          endMs: [400, 700],
          textStart: [0, 6],
          textEnd: [5, 11],
        },
      },
    },
  ]);
});
