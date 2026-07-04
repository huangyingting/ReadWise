process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type SavedWordRow = {
  id: string;
  userId: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
  dueAt: Date | null;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  createdAt: Date;
};

const USER_ID = "u1";
const NOW = new Date("2026-07-04T21:00:00Z");
let rows: SavedWordRow[] = [];
let updateArgs: { where: { id: string }; data: Record<string, unknown> } | null = null;
let wordReviews: Array<{ userId: string; word: string; correct: boolean; articleId?: string }> = [];
let skillEvidence: Array<{ userId: string; skill: string; outcome: number }> = [];

function row(overrides: Partial<SavedWordRow>): SavedWordRow {
  return {
    id: overrides.id ?? "sw",
    userId: overrides.userId ?? USER_ID,
    word: overrides.word ?? overrides.id ?? "word",
    explanation: null,
    example: null,
    contextSentence: null,
    articleId: null,
    dueAt: null,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function past(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

before(() => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  mock.module("@/lib/learning/primitives", {
    namedExports: {
      bestEffortMastery: async (_label: string, fn: () => Promise<unknown>) => fn(),
    },
  });
  mock.module("@/lib/learning/word-mastery", {
    namedExports: {
      recordWordReview: async (
        userId: string,
        word: string,
        correct: boolean,
        opts: { articleId?: string } = {},
      ) => {
        wordReviews.push({ userId, word, correct, ...opts });
      },
    },
  });
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      recordSkillEvidence: async (userId: string, skill: string, outcome: number) => {
        skillEvidence.push({ userId, skill, outcome });
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        savedWord: {
          findMany: async (args: {
            where: { userId: string; dueAt?: null | { lte: Date } };
            take: number;
          }) => {
            const filtered = rows.filter((candidate) => {
              if (candidate.userId !== args.where.userId) return false;
              if (args.where.dueAt === null) return candidate.dueAt === null;
              if (args.where.dueAt && "lte" in args.where.dueAt) {
                return candidate.dueAt !== null && candidate.dueAt <= args.where.dueAt.lte;
              }
              return candidate.dueAt === null || candidate.dueAt <= NOW;
            });
            const sorted = filtered.sort((a, b) => {
              if (a.dueAt && b.dueAt && a.dueAt.getTime() !== b.dueAt.getTime()) {
                return a.dueAt.getTime() - b.dueAt.getTime();
              }
              if (a.createdAt.getTime() !== b.createdAt.getTime()) {
                return a.createdAt.getTime() - b.createdAt.getTime();
              }
              return a.id.localeCompare(b.id);
            });
            return sorted.slice(0, args.take);
          },
          count: async (args: { where: { userId: string; OR?: unknown } }) =>
            args.where.OR
              ? rows.filter((candidate) => candidate.userId === args.where.userId && (candidate.dueAt === null || candidate.dueAt <= NOW)).length
              : rows.filter((candidate) => candidate.userId === args.where.userId).length,
          findUnique: async (args: { where: { id: string } }) =>
            rows.find((candidate) => candidate.id === args.where.id) ?? null,
          update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            updateArgs = args;
            return {};
          },
        },
      },
    },
  });
});

beforeEach(() => {
  rows = [];
  updateArgs = null;
  wordReviews = [];
  skillEvidence = [];
});

async function loadFlashcards() {
  return import("@/lib/learning/flashcards");
}

test("getDueFlashcards mixes overdue reviews ahead of new-heavy queues", async () => {
  rows = [
    row({ id: "o1", dueAt: past(5), createdAt: past(10) }),
    row({ id: "o2", dueAt: past(3), createdAt: past(9) }),
    row({ id: "n1", dueAt: null, createdAt: past(8) }),
    row({ id: "n2", dueAt: null, createdAt: past(7) }),
    row({ id: "n3", dueAt: null, createdAt: past(6) }),
    row({ id: "n4", dueAt: null, createdAt: past(5) }),
  ];

  const { getDueFlashcards, getReviewSummary } = await loadFlashcards();

  assert.deepEqual((await getDueFlashcards(USER_ID, 5)).map((card) => card.id), [
    "o1",
    "o2",
    "n1",
    "n2",
    "n3",
  ]);
  assert.equal((await getReviewSummary(USER_ID)).dueCount, 6);
});

test("getDueFlashcards still introduces new cards during overdue-heavy queues", async () => {
  rows = [
    row({ id: "o1", dueAt: past(5), createdAt: past(10) }),
    row({ id: "o2", dueAt: past(4), createdAt: past(9) }),
    row({ id: "o3", dueAt: past(3), createdAt: past(8) }),
    row({ id: "o4", dueAt: past(2), createdAt: past(7) }),
    row({ id: "o5", dueAt: past(1), createdAt: past(6) }),
    row({ id: "n1", dueAt: null, createdAt: past(5) }),
  ];

  const { getDueFlashcards } = await loadFlashcards();

  assert.deepEqual((await getDueFlashcards(USER_ID, 5)).map((card) => card.id), [
    "o1",
    "o2",
    "n1",
    "o3",
    "o4",
  ]);
});

test("gradeFlashcard returns null for missing or cross-user cards", async () => {
  rows = [row({ id: "other", userId: "u2", dueAt: past(1) })];
  const { gradeFlashcard } = await loadFlashcards();

  assert.equal(await gradeFlashcard(USER_ID, "missing", "good"), null);
  assert.equal(await gradeFlashcard(USER_ID, "other", "good"), null);
  assert.equal(updateArgs, null);
});

test("gradeFlashcard writes the next schedule and mastery metadata", async () => {
  rows = [
    row({
      id: "card-1",
      word: "ephemeral",
      articleId: "article-1",
      dueAt: past(1),
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
    } as Partial<SavedWordRow>),
  ];
  const { gradeFlashcard } = await loadFlashcards();

  const result = await gradeFlashcard(USER_ID, "card-1", "good");

  assert.ok(result?.dueAt);
  assert.equal(result?.intervalDays, 1);
  assert.equal(updateArgs?.where.id, "card-1");
  assert.equal(updateArgs?.data.intervalDays, 1);
  assert.equal(updateArgs?.data.repetitions, 1);
  assert.deepEqual(wordReviews, [
    { userId: USER_ID, word: "ephemeral", correct: true, articleId: "article-1" },
  ]);
  assert.deepEqual(skillEvidence, [
    { userId: USER_ID, skill: "vocabulary", outcome: 0.75 },
  ]);
});
