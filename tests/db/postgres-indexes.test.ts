import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { cleanIntegrationRows } from "./support/db-helpers";
import { assertUsesAnyIndex, assertUsesIndexes, explainIndexNames } from "./support/explain-helpers";
import { seedQueryPlanFixture } from "./support/fixtures";

afterEach(async () => {
  if (enabled) await cleanIntegrationRows();
});

after(async () => {
  await prisma.$disconnect();
});

test("PostgreSQL core flow query plans use documented indexes", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const { userId } = await seedQueryPlanFixture();

  const feedIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
  );
  assertUsesIndexes(feedIndexes, ["Article_public_feed_idx"]);

  const categoryIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "category" = 'science'
     ORDER BY "publishedAt" DESC, "createdAt" DESC
     LIMIT 20`,
  );
  assertUsesAnyIndex(categoryIndexes, [
    "Article_public_category_feed_idx",
    "Article_public_feed_idx",
  ]);

  const recommendationIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = 'published'::"ArticleStatus"
       AND "visibility" = 'PUBLIC'::"ArticleVisibility"
       AND "ownerId" IS NULL
       AND "difficulty" = 'B1'
     ORDER BY "difficultyScore" ASC, "publishedAt" DESC
     LIMIT 20`,
  );
  assertUsesIndexes(recommendationIndexes, ["Article_public_level_feed_idx"]);

  const workerIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE "status" = $1::"ArticleStatus"
     ORDER BY "createdAt" ASC
     LIMIT 20`,
    "draft",
  );
  assertUsesIndexes(workerIndexes, ["Article_status_created_idx"]);

  const progressIndexes = await explainIndexNames(
    `SELECT "articleId", "percent", "completed"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = false
     ORDER BY "updatedAt" DESC
     LIMIT 10`,
    userId,
  );
  assertUsesIndexes(progressIndexes, ["ReadingProgress_user_completed_updated_idx"]);

  const analyticsIndexes = await explainIndexNames(
    `SELECT "completedAt"
     FROM "ReadingProgress"
     WHERE "userId" = $1
       AND "completed" = true
       AND "completedAt" >= $2
     ORDER BY "completedAt" DESC
     LIMIT 50`,
    userId,
    new Date(Date.now() - 12 * 7 * 86_400_000),
  );
  assertUsesIndexes(analyticsIndexes, ["ReadingProgress_user_completedAt_idx"]);

  const savedWordsIndexes = await explainIndexNames(
    `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    userId,
  );
  assertUsesIndexes(savedWordsIndexes, ["SavedWord_user_created_idx"]);

  const dueWordIndexes = await explainIndexNames(
    `SELECT "id", "word"
     FROM "SavedWord"
     WHERE "userId" = $1
       AND ("dueAt" IS NULL OR "dueAt" <= $2)
     ORDER BY "dueAt" ASC
     LIMIT 20`,
    userId,
    new Date(),
  );
  assertUsesIndexes(dueWordIndexes, ["SavedWord_due_idx"]);

  const searchIndexes = await explainIndexNames(
    `SELECT "id"
     FROM "Article"
     WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", ''))
       @@ plainto_tsquery('english', $1)
     LIMIT 20`,
    "nebula",
  );
  assertUsesIndexes(searchIndexes, ["Article_search_vector_idx"]);
});
