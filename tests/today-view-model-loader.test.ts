import assert from "node:assert/strict";
import { before, test, mock } from "node:test";

const NOW = new Date("2026-07-18T23:30:00Z");

type ReadableCall = {
  id: string;
  context: { userId: string | null; role: string | null };
  options: { select: Record<string, boolean> };
};

let sessionAccessArgs: Record<string, unknown> | null = null;
const readableCalls: ReadableCall[] = [];

const session = {
  id: "today-1",
  userId: "user-1",
  localDate: "2026-07-19",
  timezoneSnapshot: "Asia/Tokyo",
  primaryArticleId: "primary-1",
  backupArticleIds: ["missing-backup", "backup-2"],
  targetSavedWordIds: [],
  reviewTargetCount: 0,
  status: "active",
  source: "picks",
  completionTier: "none",
  generationReasonCode: "picks_primary",
  readingCompletedAt: null,
  comprehensionCompletedAt: null,
  wordReviewCompletedAt: null,
  completedAt: null,
  skipped: false,
  skipReason: null,
  skippedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function articleCardSource(id: string) {
  return {
    id,
    title: `Title ${id}`,
    author: null,
    source: null,
    category: "science",
    difficulty: "B1",
    readingMinutes: 4,
    wordCount: 720,
    publishedAt: null,
    heroImage: null,
  };
}

before(() => {
  mock.module("@/lib/engagement/today-session/generator", {
    namedExports: {
      getOrCreateTodaySession: async (args: Record<string, unknown>) => {
        sessionAccessArgs = args;
        return session;
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContextForUser: async (user: { id: string; role: string | null }) => ({
        userId: user.id,
        role: user.role,
      }),
      getReadableArticleById: async (
        id: string,
        context: ReadableCall["context"],
        options: ReadableCall["options"],
      ) => {
        readableCalls.push({ id, context, options });
        return id === "missing-backup" ? null : articleCardSource(id);
      },
      toListingArticle: (article: ReturnType<typeof articleCardSource>) => ({
        id: article.id,
        title: article.title,
        author: article.author,
        source: article.source,
        category: article.category,
        difficulty: article.difficulty,
        readingMinutes: article.readingMinutes,
        publishedAt: article.publishedAt,
        heroImage: article.heroImage,
      }),
    },
  });

  mock.module("@/lib/engagement/today-session/analytics", {
    namedExports: {
      emitTodaySessionViewed: async () => {},
    },
  });

  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => null,
    },
  });
});

test("Today view loader owns daily scope and readable article assembly", async () => {
  const { loadTodayViewModel } = await import(
    "@/lib/engagement/today-session/view-model"
  );

  const result = await loadTodayViewModel({
    user: { id: "user-1", role: "Reader" },
    requestTimezone: "Asia/Tokyo",
    now: NOW,
  });

  assert.deepEqual(sessionAccessArgs, {
    userId: "user-1",
    requestTimezone: "Asia/Tokyo",
    now: NOW,
  });
  assert.equal(result.localDate, "2026-07-19");
  assert.equal(result.timezone, "Asia/Tokyo");
  assert.equal(result.primaryArticle?.id, "primary-1");
  assert.deepEqual(result.backups.map(({ id }) => id), ["backup-2"]);

  assert.deepEqual(
    readableCalls.map(({ id }) => id),
    ["primary-1", "missing-backup", "backup-2"],
  );
  assert.ok(
    readableCalls.every(
      ({ context }) =>
        context.userId === "user-1" && context.role === "Reader",
    ),
  );
  assert.ok(
    readableCalls.every(({ options }) => !("content" in options.select)),
  );
});
