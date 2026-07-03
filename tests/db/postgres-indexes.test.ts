import assert from "node:assert/strict";
import { test } from "node:test";

import { enabled, isPostgres } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { assertUsesAnyIndex, assertUsesIndexes, explainIndexNames } from "./support/explain-helpers";
import { seedQueryPlanFixture } from "./support/fixtures";

registerIntegrationCleanup();

type IndexExpectation =
  | { readonly mode: "all"; readonly indexes: readonly string[] }
  | { readonly mode: "any"; readonly indexes: readonly string[] };

type QueryPlanCase = {
  readonly name: string;
  readonly sql: string;
  readonly params?: (fixture: { userId: string; now: Date }) => unknown[];
  readonly expectation: IndexExpectation;
};

const TWELVE_WEEKS_MS = 12 * 7 * 86_400_000;

const queryPlanCases: readonly QueryPlanCase[] = [
  {
    name: "public feed",
    sql: `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
    expectation: { mode: "all", indexes: ["Article_public_feed_idx"] },
  },
  {
    name: "public category feed",
    sql: `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "category" = 'science'
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
    expectation: {
      mode: "any",
      indexes: ["Article_public_category_feed_idx", "Article_public_feed_idx"],
    },
  },
  {
    name: "recommendations by level",
    sql: `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "difficulty" = 'B1'
     ORDER BY "difficultyScore" ASC, "publishedAt" DESC
     LIMIT 20`,
    expectation: { mode: "all", indexes: ["Article_public_level_feed_idx"] },
  },
  {
    name: "draft worker queue",
    sql: `SELECT "id"
     FROM "Article"
     WHERE "status" = $1::"ArticleStatus"
     ORDER BY "createdAt" ASC
     LIMIT 20`,
    params: () => ["draft"],
    expectation: { mode: "all", indexes: ["Article_status_created_idx"] },
  },
  {
    name: "incomplete reading progress",
    sql: `SELECT "articleId", "percent", "completed"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = false
     ORDER BY "updatedAt" DESC
     LIMIT 10`,
    params: ({ userId }) => [userId],
    expectation: { mode: "all", indexes: ["ReadingProgress_user_completed_updated_idx"] },
  },
  {
    name: "completed reading progress analytics",
    sql: `SELECT "completedAt"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = true
       AND "completedAt" >= $2
     ORDER BY "completedAt" DESC
     LIMIT 50`,
    params: ({ userId, now }) => [userId, new Date(now.getTime() - TWELVE_WEEKS_MS)],
    expectation: { mode: "all", indexes: ["ReadingProgress_user_completedAt_idx"] },
  },
  {
    name: "saved words by created date",
    sql: `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    params: ({ userId }) => [userId],
    expectation: { mode: "all", indexes: ["SavedWord_user_created_idx"] },
  },
  {
    name: "due saved words",
    sql: `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
       AND ("dueAt" IS NULL OR "dueAt" <= $2)
     ORDER BY "dueAt" ASC
     LIMIT 20`,
    params: ({ userId, now }) => [userId, now],
    expectation: { mode: "all", indexes: ["SavedWord_due_idx"] },
  },
  {
    name: "article full-text search",
    sql: `SELECT "id"
     FROM "Article"
     WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
       @@ plainto_tsquery('english', $1)
     LIMIT 20`,
    params: () => ["nebula"],
    expectation: { mode: "all", indexes: ["Article_search_vector_idx"] },
  },
];

function assertIndexExpectation(actual: Set<string>, expectation: IndexExpectation): void {
  if (expectation.mode === "any") {
    assertUsesAnyIndex(actual, expectation.indexes);
    return;
  }
  assertUsesIndexes(actual, expectation.indexes);
}

test("PostgreSQL core flow query plans use documented indexes", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const fixture = { ...(await seedQueryPlanFixture()), now: new Date() };

  for (const queryCase of queryPlanCases) {
    const indexes = await explainIndexNames(queryCase.sql, ...(queryCase.params?.(fixture) ?? []));
    assertIndexExpectation(indexes, queryCase.expectation);
  }
});
