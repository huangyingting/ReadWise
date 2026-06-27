/**
 * Unit tests for the article-library admin command module (REF-040).
 *
 * Exercises searchArticles, getAdminArticleDetail, deleteArticle,
 * getAdminArticleStatuses, and rebuildArticleAi — including happy paths,
 * pagination/filtering, permission gating (non-operator contexts resolve to the
 * DENIED sentinel via the real policy module), cascade/side-effect clearing,
 * and audit invocation.
 *
 * `@/lib/prisma`, `@/lib/security/audit`, and `@/lib/processing/state` are
 * mocked via node:test module mocking. The real `./policy` and `./mapper`
 * modules are used so the access-control WHERE builders are genuinely
 * exercised. No real DB or network is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus, type Article } from "@prisma/client";
import { buildArticle } from "./helpers";

const DENIED_ID = "__readwise_article_access_denied__";

type Where = Record<string, unknown> | undefined;

/** Returns true when a WHERE resolves to the policy DENIED sentinel. */
function isDenied(where: Where): boolean {
  return Boolean(where && (where as { id?: string }).id === DENIED_ID);
}

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let articleRows: Article[] = [];
let articleTotal = 0;
let detailArticle: Article | null = null;
let countByModel: Record<string, number> = {};
let feedbackRows: { vote: string }[] = [];
let processingStepsResult: unknown[] = [];

let deletedIds: string[] = [];
let deleteManyCalls: Record<string, { where: Record<string, unknown> }[]> = {};
let deleteManyCounts: Record<string, number> = {};
let auditCalls: { action: string }[] = [];

let lastFindManyArgs: Record<string, unknown> | null = null;

function resetDeleteMany() {
  deleteManyCalls = {};
  for (const model of [
    "translation",
    "vocabularyItem",
    "quizQuestion",
    "articleTag",
    "articleSpeech",
    "mediaAsset",
    "articleProcessingStep",
  ]) {
    deleteManyCalls[model] = [];
  }
}

function recordDeleteMany(model: string) {
  return async (args: { where: Record<string, unknown> }) => {
    deleteManyCalls[model].push(args);
    return { count: deleteManyCounts[model] ?? 0 };
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  const mockPrisma: Record<string, unknown> = {};

  Object.assign(mockPrisma, {
    article: {
      count: async (args: { where?: Where } = {}) =>
        isDenied(args.where) ? 0 : articleTotal,
      findMany: async (args: { where?: Where; distinct?: string[] } = {}) => {
        lastFindManyArgs = args as Record<string, unknown>;
        if (isDenied(args.where)) return [];
        if (args.distinct?.includes("status")) {
          const seen = new Set<string>();
          const unique: { status: string }[] = [];
          for (const row of articleRows) {
            if (!seen.has(row.status)) {
              seen.add(row.status);
              unique.push({ status: row.status });
            }
          }
          unique.sort((a, b) => a.status.localeCompare(b.status));
          return unique;
        }
        return articleRows;
      },
      // Used by policy.getAdminVisibleArticleById and the transaction guards.
      findFirst: async (args: { where?: Where } = {}) =>
        isDenied(args.where) ? null : detailArticle,
      delete: async (args: { where: { id: string } }) => {
        deletedIds.push(args.where.id);
        return { id: args.where.id };
      },
    },
    translation: {
      count: async () => countByModel.translation ?? 0,
      deleteMany: recordDeleteMany("translation"),
    },
    vocabularyItem: {
      count: async () => countByModel.vocabularyItem ?? 0,
      deleteMany: recordDeleteMany("vocabularyItem"),
    },
    quizQuestion: {
      count: async () => countByModel.quizQuestion ?? 0,
      deleteMany: recordDeleteMany("quizQuestion"),
    },
    articleTag: {
      count: async () => countByModel.articleTag ?? 0,
      deleteMany: recordDeleteMany("articleTag"),
    },
    articleSpeech: {
      count: async () => countByModel.articleSpeech ?? 0,
      deleteMany: recordDeleteMany("articleSpeech"),
    },
    readingProgress: {
      count: async () => countByModel.readingProgress ?? 0,
    },
    articleDifficultyFeedback: {
      findMany: async () => feedbackRows,
    },
    mediaAsset: {
      deleteMany: recordDeleteMany("mediaAsset"),
    },
    articleProcessingStep: {
      deleteMany: recordDeleteMany("articleProcessingStep"),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma),
  });

  mock.module("@/lib/prisma", { namedExports: { prisma: mockPrisma } });

  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push({ action: input.action });
      },
    },
  });

  mock.module("@/lib/processing/state", {
    namedExports: {
      getArticleProcessingSteps: async () => processingStepsResult,
    },
  });
});

beforeEach(() => {
  articleRows = [];
  articleTotal = 0;
  detailArticle = null;
  countByModel = {};
  feedbackRows = [];
  processingStepsResult = [];
  deletedIds = [];
  deleteManyCounts = {};
  auditCalls = [];
  lastFindManyArgs = null;
  resetDeleteMany();
});

const ADMIN = { role: "Admin" } as const;

// ---------------------------------------------------------------------------
// searchArticles
// ---------------------------------------------------------------------------

test("searchArticles returns mapped rows with pagination metadata", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleRows = [
    buildArticle({ id: "a1", title: "Alpha", wordCount: 400 }),
    buildArticle({ id: "a2", title: "Beta", readingMinutes: 7 }),
  ];
  articleTotal = 2;

  const result = await searchArticles({ context: ADMIN });

  assert.equal(result.total, 2);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 20);
  assert.equal(result.totalPages, 1);
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[0].id, "a1");
  // readingMinutesFor derives from wordCount (400 / 200 wpm = 2)
  assert.equal(result.articles[0].readingMinutes, 2);
  assert.equal(result.articles[1].readingMinutes, 7);
});

test("searchArticles trims the query and applies an OR title/author/source filter", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleRows = [buildArticle({ id: "a1" })];
  articleTotal = 1;

  const result = await searchArticles({ query: "  climate  ", context: ADMIN });

  assert.equal(result.query, "climate");
  const where = lastFindManyArgs?.where as { OR?: unknown[] };
  assert.ok(Array.isArray(where.OR), "where should carry an OR filter");
  assert.equal(where.OR!.length, 3);
});

test("searchArticles normalizes a valid status filter to upper case", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleRows = [];
  articleTotal = 0;

  const result = await searchArticles({ status: "published", context: ADMIN });

  assert.equal(result.status, "PUBLISHED");
  const where = lastFindManyArgs?.where as { status?: string };
  assert.equal(where.status, ArticleStatus.PUBLISHED);
});

test("searchArticles ignores an unknown status value", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  const result = await searchArticles({ status: "bogus", context: ADMIN });

  assert.equal(result.status, null);
  const where = lastFindManyArgs?.where as { status?: string };
  assert.equal(where.status, undefined);
});

test("searchArticles computes skip/take for a later page", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleTotal = 45;
  articleRows = [buildArticle({ id: "p3" })];

  const result = await searchArticles({ page: 3, pageSize: 10, context: ADMIN });

  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 10);
  assert.equal(result.totalPages, 5); // ceil(45 / 10)
  assert.equal(lastFindManyArgs?.skip, 20); // (3 - 1) * 10
  assert.equal(lastFindManyArgs?.take, 10);
});

test("searchArticles clamps a non-positive page to 1", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  const result = await searchArticles({ page: 0, context: ADMIN });
  assert.equal(result.page, 1);
  assert.equal(lastFindManyArgs?.skip, 0);
});

test("searchArticles reports at least one page even with zero results", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleTotal = 0;
  const result = await searchArticles({ context: ADMIN });
  assert.equal(result.total, 0);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.articles, []);
});

test("searchArticles returns no rows for a non-operator context (DENIED policy)", async () => {
  const { searchArticles } = await import("@/lib/article-library/admin");
  articleRows = [buildArticle({ id: "a1" })];
  articleTotal = 5;

  const result = await searchArticles({ context: { role: "Reader", userId: "u1" } });

  assert.equal(result.total, 0);
  assert.deepEqual(result.articles, []);
});

// ---------------------------------------------------------------------------
// getAdminArticleDetail
// ---------------------------------------------------------------------------

test("getAdminArticleDetail returns null for an unknown id", async () => {
  const { getAdminArticleDetail } = await import("@/lib/article-library/admin");
  detailArticle = null;
  const detail = await getAdminArticleDetail("missing", ADMIN);
  assert.equal(detail, null);
});

test("getAdminArticleDetail returns null for a non-operator context", async () => {
  const { getAdminArticleDetail } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  // Non-operator → policy DENIED sentinel → findFirst returns null.
  const detail = await getAdminArticleDetail("a1", { role: "Reader", userId: "u1" });
  assert.equal(detail, null);
});

test("getAdminArticleDetail assembles AI counts, feedback distribution and steps", async () => {
  const { getAdminArticleDetail } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1", title: "Detail" });
  countByModel = {
    translation: 3,
    vocabularyItem: 9,
    quizQuestion: 4,
    articleTag: 2,
    articleSpeech: 1,
    readingProgress: 6,
  };
  feedbackRows = [
    { vote: "too_easy" },
    { vote: "too_easy" },
    { vote: "just_right" },
    { vote: "too_hard" },
    { vote: "unknown_value" },
  ];
  processingStepsResult = [{ step: "difficulty", status: "done" }];

  const detail = await getAdminArticleDetail("a1", ADMIN);

  assert.ok(detail);
  assert.equal(detail!.article.id, "a1");
  assert.deepEqual(detail!.counts, {
    translations: 3,
    vocabulary: 9,
    quizQuestions: 4,
    tags: 2,
    speech: 1,
    readingProgress: 6,
  });
  assert.equal(detail!.difficultyFeedback.total, 5);
  assert.equal(detail!.difficultyFeedback.tooEasy, 2);
  assert.equal(detail!.difficultyFeedback.justRight, 1);
  assert.equal(detail!.difficultyFeedback.tooHard, 1);
  assert.deepEqual(detail!.processingSteps, [{ step: "difficulty", status: "done" }]);
});

test("getAdminArticleDetail uses the System context by default", async () => {
  const { getAdminArticleDetail } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  const detail = await getAdminArticleDetail("a1");
  assert.ok(detail);
  assert.equal(detail!.difficultyFeedback.total, 0);
});

// ---------------------------------------------------------------------------
// deleteArticle
// ---------------------------------------------------------------------------

test("deleteArticle returns false when the article does not exist", async () => {
  const { deleteArticle } = await import("@/lib/article-library/admin");
  detailArticle = null;
  const ok = await deleteArticle("missing", ADMIN);
  assert.equal(ok, false);
  assert.equal(deletedIds.length, 0);
});

test("deleteArticle returns false for a non-operator context", async () => {
  const { deleteArticle } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  const ok = await deleteArticle("a1", { role: "Reader", userId: "u1" });
  assert.equal(ok, false);
  assert.equal(deletedIds.length, 0);
});

test("deleteArticle deletes the article and returns true (no audit)", async () => {
  const { deleteArticle } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  const ok = await deleteArticle("a1", ADMIN);
  assert.equal(ok, true);
  assert.deepEqual(deletedIds, ["a1"]);
  assert.equal(auditCalls.length, 0);
});

test("deleteArticle records an audit event when an audit input is supplied", async () => {
  const { deleteArticle } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  const ok = await deleteArticle("a1", ADMIN, {
    action: "admin.article.delete",
  } as never);
  assert.equal(ok, true);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.article.delete");
});

// ---------------------------------------------------------------------------
// getAdminArticleStatuses
// ---------------------------------------------------------------------------

test("getAdminArticleStatuses returns distinct sorted statuses for an operator", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [
    buildArticle({ id: "a1", status: ArticleStatus.PUBLISHED }),
    buildArticle({ id: "a2", status: ArticleStatus.DRAFT }),
    buildArticle({ id: "a3", status: ArticleStatus.PUBLISHED }),
  ];
  const statuses = await getAdminArticleStatuses(ADMIN);
  assert.deepEqual(statuses, ["DRAFT", "PUBLISHED"]);
});

test("getAdminArticleStatuses returns an empty list for a non-operator", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [buildArticle({ id: "a1", status: ArticleStatus.PUBLISHED })];
  const statuses = await getAdminArticleStatuses({ role: "Reader", userId: "u1" });
  assert.deepEqual(statuses, []);
});

// ---------------------------------------------------------------------------
// rebuildArticleAi
// ---------------------------------------------------------------------------

test("rebuildArticleAi returns null when the article does not exist", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = null;
  const result = await rebuildArticleAi("missing", ADMIN);
  assert.equal(result, null);
  assert.equal(deleteManyCalls.translation.length, 0);
});

test("rebuildArticleAi returns null for a non-operator context", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  const result = await rebuildArticleAi("a1", { role: "Reader", userId: "u1" });
  assert.equal(result, null);
  assert.equal(deleteManyCalls.translation.length, 0);
});

test("rebuildArticleAi clears derived AI content and reports cleared counts", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  deleteManyCounts = {
    translation: 5,
    vocabularyItem: 12,
    quizQuestion: 4,
    articleTag: 3,
    articleSpeech: 1,
  };

  const result = await rebuildArticleAi("a1", ADMIN);

  assert.ok(result);
  assert.deepEqual(result!.cleared, {
    translations: 5,
    vocabulary: 12,
    quizQuestions: 4,
    tags: 3,
    speech: 1,
    readingProgress: 0, // progress is preserved
  });
  // All AI derivatives were targeted for deletion.
  assert.equal(deleteManyCalls.translation.length, 1);
  assert.equal(deleteManyCalls.vocabularyItem.length, 1);
  assert.equal(deleteManyCalls.quizQuestion.length, 1);
  assert.equal(deleteManyCalls.articleTag.length, 1);
  assert.equal(deleteManyCalls.articleSpeech.length, 1);
});

test("rebuildArticleAi drops only speech-kind media assets for the article", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  await rebuildArticleAi("a1", ADMIN);
  assert.equal(deleteManyCalls.mediaAsset.length, 1);
  assert.deepEqual(deleteManyCalls.mediaAsset[0].where, {
    articleId: "a1",
    kind: "speech",
  });
});

test("rebuildArticleAi resets processing steps but preserves the difficulty step", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  await rebuildArticleAi("a1", ADMIN);
  assert.equal(deleteManyCalls.articleProcessingStep.length, 1);
  assert.deepEqual(deleteManyCalls.articleProcessingStep[0].where, {
    articleId: "a1",
    step: { not: "difficulty" },
  });
});

test("rebuildArticleAi records an audit event built from the result", async () => {
  const { rebuildArticleAi } = await import("@/lib/article-library/admin");
  detailArticle = buildArticle({ id: "a1" });
  deleteManyCounts = { translation: 2 };

  let seenTranslations: number | null = null;
  const result = await rebuildArticleAi("a1", ADMIN, (r) => {
    seenTranslations = r.cleared.translations;
    return { action: "admin.article.rebuild_ai" } as never;
  });

  assert.ok(result);
  assert.equal(seenTranslations, 2);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.article.rebuild_ai");
});
