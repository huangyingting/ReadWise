process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

type ProgressRow = {
  id: string;
  userId: string;
  articleId: string;
  percent: number;
  completed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  article?: Record<string, unknown>;
};

const now = new Date("2026-01-01T00:00:00Z");

let progressRows: ProgressRow[] = [];
let progressFindUniqueQueue: Array<ProgressRow | null> = [];
let progressFindManyCalls: unknown[] = [];
let activityThrows = false;
let exposureCalls: Array<{ userId: string; articleId: string }> = [];

let savedWordsRows: Record<string, unknown>[] = [];
let savedWordCount = 0;
let savedWordFindManyCalls: unknown[] = [];
let savedWordCountCalls: unknown[] = [];
let savedWordUpserts: unknown[] = [];
let savedWordDeleteCalls: unknown[] = [];
let articleFindManyCalls: unknown[] = [];
let articleRows: Array<{ id: string; title: string }> = [];

let seriesRows: Record<string, unknown>[] = [];
let enrollmentRows: Record<string, unknown>[] = [];

function makeProgress(partial: Partial<ProgressRow> = {}): ProgressRow {
  return {
    id: "progress-1",
    userId: "user-1",
    articleId: "article-1",
    percent: 40,
    completed: false,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        error: () => {},
        info: () => {},
        warn: () => {},
      }),
    },
  });
  mock.module("@/lib/engagement/activity", {
    namedExports: {
      recordReadingActivity: async () => {
        if (activityThrows) throw new Error("activity unavailable");
      },
    },
  });
  mock.module("@/lib/learning/reading-exposure", {
    namedExports: {
      recordReadingWordExposures: async (userId: string, articleId: string) => {
        exposureCalls.push({ userId, articleId });
        return 1;
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: () => ({ status: "PUBLISHED" }),
      toListingArticle: (article: Record<string, unknown>) => ({
        id: article.id,
        title: article.title,
      }),
    },
  });
  mock.module("@/lib/article-library/policy", {
    namedExports: {
      readableArticleWhere: (_context: unknown, where: unknown) => ({
        readable: true,
        ...(where as object),
      }),
      getPublicListableArticleById: async (id: string) => ({ id }),
    },
  });
  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { seriesEnrolled: "series_enrolled" },
      recordEvent: async () => {},
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingProgress: {
          findUnique: async (args: unknown) => {
            void args;
            if (progressFindUniqueQueue.length > 0) {
              return progressFindUniqueQueue.shift() ?? null;
            }
            return progressRows[0] ?? null;
          },
          findMany: async (args: { include?: { article?: boolean } }) => {
            progressFindManyCalls.push(args);
            return progressRows;
          },
          create: async ({ data }: { data: Omit<ProgressRow, "id" | "createdAt" | "updatedAt"> }) => {
            const row = makeProgress({ ...data, id: `progress-${progressRows.length + 1}` });
            progressRows = [row];
            return row;
          },
          updateMany: async ({ where, data }: { where: { id: string; percent: { lte: number } }; data: Partial<ProgressRow> }) => {
            const row = progressRows.find((r) => r.id === where.id);
            if (row && row.percent <= where.percent.lte) {
              Object.assign(row, data);
              return { count: 1 };
            }
            return { count: 0 };
          },
        },
        savedWord: {
          findMany: async (args: unknown) => {
            savedWordFindManyCalls.push(args);
            return savedWordsRows;
          },
          count: async (args: unknown) => {
            savedWordCountCalls.push(args);
            return savedWordCount;
          },
          upsert: async (args: unknown) => {
            savedWordUpserts.push(args);
            return {};
          },
          deleteMany: async (args: unknown) => {
            savedWordDeleteCalls.push(args);
            return { count: 1 };
          },
        },
        article: {
          findMany: async (args: unknown) => {
            articleFindManyCalls.push(args);
            return articleRows;
          },
        },
        readingSeries: {
          findMany: async () => seriesRows,
          findFirst: async ({ where }: { where: { id: string } }) =>
            seriesRows.find((row) => row.id === where.id) ?? null,
        },
        seriesEnrollment: {
          findMany: async () => enrollmentRows,
          upsert: async () => ({}),
          deleteMany: async () => ({ count: 1 }),
          findFirst: async () => null,
          update: async () => ({}),
          findUnique: async () => null,
        },
      },
    },
  });
});

beforeEach(() => {
  progressRows = [];
  progressFindUniqueQueue = [];
  progressFindManyCalls = [];
  activityThrows = false;
  exposureCalls = [];
  savedWordsRows = [];
  savedWordCount = 0;
  savedWordFindManyCalls = [];
  savedWordCountCalls = [];
  savedWordUpserts = [];
  savedWordDeleteCalls = [];
  articleFindManyCalls = [];
  articleRows = [];
  seriesRows = [];
  enrollmentRows = [];
});

test("progress read models batch rows, summarize them, and render in-progress articles", async () => {
  const { getProgressMap, getProgressSummaries, listInProgressArticles } =
    await import("@/lib/engagement/progress");
  assert.equal((await getProgressMap("user-1", [])).size, 0);
  assert.equal(progressFindManyCalls.length, 0, "empty batch should avoid a query");

  progressRows = [
    makeProgress({
      id: "p1",
      articleId: "a1",
      percent: 20,
      article: { id: "a1", title: "Started article" },
    }),
    makeProgress({
      id: "p2",
      articleId: "a2",
      percent: 95,
      completed: true,
      completedAt: now,
      article: { id: "a2", title: "Readable article" },
    }),
  ];

  const map = await getProgressMap("user-1", ["a1", "a2"]);
  assert.equal(map.get("a1")?.percent, 20);
  assert.deepEqual(await getProgressSummaries("user-1", ["a1", "a2"]), {
    a1: { percent: 20, completed: false },
    a2: { percent: 95, completed: true },
  });

  const entries = await listInProgressArticles("user-1", 5);
  assert.deepEqual(entries[1], {
    article: { id: "a2", title: "Readable article" },
    progress: { percent: 95, completed: true },
  });
});

test("saveProgress is resilient to activity failures and records completion exposure once", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  activityThrows = true;

  const row = await saveProgress("user-1", "article-1", 96);

  assert.equal(row.completed, true);
  assert.equal(exposureCalls.length, 1);
  assert.deepEqual(exposureCalls[0], { userId: "user-1", articleId: "article-1" });
});

test("saveProgress retries vanished rows and eventually reports disappearance", async () => {
  const { saveProgress } = await import("@/lib/engagement/progress");
  const existing = makeProgress({ id: "vanishing", percent: 10 });
  progressRows = [existing];
  progressFindUniqueQueue = [
    existing,
    existing,
    null,
    existing,
    null,
    existing,
    null,
  ];

  await assert.rejects(
    () => saveProgress("user-1", "article-1", 30),
    /progress row disappeared/,
  );
});

test("saved-word repository builds query shapes and handles no-op deletes safely", async () => {
  const {
    WORDS_PAGE_SIZE,
    getSavedWords,
    getFilteredSavedWords,
    saveWord,
    unsaveWord,
    getArticleTitlesForWords,
  } = await import("@/lib/lexical/saved-words");

  savedWordsRows = [
    {
      id: "word-1",
      word: "resilient",
      explanation: "able to recover",
      example: null,
      contextSentence: null,
      articleId: "article-1",
      createdAt: now,
      dueAt: null,
    },
  ];
  assert.equal((await getSavedWords("user-1"))[0].word, "resilient");

  savedWordCount = WORDS_PAGE_SIZE + 1;
  const filtered = await getFilteredSavedWords("user-1", {
    search: "res",
    articleId: "article-1",
    filter: "due",
    page: 0,
  });
  assert.equal(filtered.page, 1);
  assert.equal(filtered.totalPages, 2);
  const countWhere = (savedWordCountCalls[0] as { where: Record<string, unknown> }).where;
  assert.equal(countWhere.userId, "user-1");
  assert.equal(countWhere.articleId, "article-1");
  assert.ok(Array.isArray(countWhere.OR), "due/search filters should contribute OR predicates");

  await saveWord("user-1", {
    word: "  Durable  ",
    explanation: undefined,
    example: "example",
    contextSentence: null,
    articleId: null,
  });
  const upsert = savedWordUpserts[0] as { where: { userId_word: { word: string } }; create: { word: string; explanation: unknown } };
  assert.equal(upsert.where.userId_word.word, "Durable");
  assert.equal(upsert.create.word, "Durable");
  assert.equal(upsert.create.explanation, null);

  await saveWord("user-1", { word: "   " });
  await unsaveWord("user-1", "   ");
  assert.equal(savedWordUpserts.length, 1, "blank save should not upsert");
  assert.equal(savedWordDeleteCalls.length, 0, "blank unsave should not delete");

  await unsaveWord("user-1", " Durable ");
  assert.deepEqual(savedWordDeleteCalls[0], { where: { userId: "user-1", word: "Durable" } });

  assert.deepEqual(await getArticleTitlesForWords([], { userId: "user-1" } as never), {});
  articleRows = [{ id: "article-1", title: "Accessible title" }];
  assert.deepEqual(await getArticleTitlesForWords(["article-1"], { userId: "user-1" } as never), {
    "article-1": "Accessible title",
  });
  assert.equal(articleFindManyCalls.length, 1);
});

test("saved-word set matching is case-insensitive and avoids empty input queries", async () => {
  const { getSavedWordSet } = await import("@/lib/lexical/saved-words");
  assert.equal((await getSavedWordSet("user-1", [])).size, 0);
  assert.equal(savedWordFindManyCalls.length, 0);

  savedWordsRows = [{ word: "Robust" }, { word: "Careful" }];
  assert.deepEqual(
    [...(await getSavedWordSet("user-1", ["robust", "ROBUST", "missing"]))].sort(),
    ["robust"],
  );
});

test("series listing attaches privacy-safe enrollment summaries and article counts", async () => {
  const { listPublicSeriesForUser } = await import("@/lib/engagement/series");
  seriesRows = [
    {
      id: "series-1",
      slug: "daily-science",
      title: "Daily Science",
      description: "Short science sequence",
      topic: "science",
      targetLevelMin: "B1",
      targetLevelMax: "B2",
      articleIds: ["article-1", "", 7, "article-2"],
    },
    {
      id: "series-2",
      slug: "empty",
      title: "Empty",
      description: null,
      topic: null,
      targetLevelMin: null,
      targetLevelMax: null,
      articleIds: "not-json-array",
    },
  ];
  enrollmentRows = [
    {
      seriesId: "series-1",
      status: "paused",
      nextIndex: 2,
      startedAt: now,
      completedAt: null,
    },
  ];

  const cards = await listPublicSeriesForUser("user-1");

  assert.equal(cards[0].articleCount, 2);
  assert.deepEqual(cards[0].enrollment, {
    status: "paused",
    nextIndex: 2,
    startedAt: now,
    completedAt: null,
  });
  assert.equal(cards[1].articleCount, 0);
  assert.equal(cards[1].enrollment, null);
});

test("progress creation propagates non-unique write errors", async () => {
  progressRows = [];
  const prismaModule = await import("@/lib/prisma");
  const originalCreate = prismaModule.prisma.readingProgress.create;
  prismaModule.prisma.readingProgress.create = (async () => {
    throw new Prisma.PrismaClientKnownRequestError("not unique", {
      code: "P2025",
      clientVersion: "test",
    });
  }) as unknown as typeof prismaModule.prisma.readingProgress.create;
  const { saveProgress } = await import("@/lib/engagement/progress");
  try {
    await assert.rejects(() => saveProgress("user-1", "article-1", 10), /not unique/);
  } finally {
    prismaModule.prisma.readingProgress.create = originalCreate;
  }
});
