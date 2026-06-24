process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function readAllMigrations(path: string): string {
  return readdirSync(join(ROOT, path))
    .filter((dir) => /^\d/.test(dir))
    .map((dir) => read(`${path}/${dir}/migration.sql`))
    .join("\n");
}

test("Prisma schema records indexes for core feed/search/admin/worker flows", () => {
  const schema = read("prisma/schema.prisma");
  for (const indexName of [
    "Article_visibility_feed_idx",
    "Article_category_feed_idx",
    "Article_level_feed_idx",
    "Article_owner_status_created_idx",
    "Article_status_created_idx",
    "SavedWord_user_article_idx",
    "SavedWord_user_created_idx",
    "SavedWord_due_idx",
    "ReadingProgress_user_completed_updated_idx",
    "ReadingProgress_user_completedAt_idx",
    "ReadingProgress_article_idx",
    "Highlight_user_created_idx",
    "User_role_created_idx",
  ]) {
    assert.match(schema, new RegExp(`map: "${indexName}"`), `${indexName} missing from schema`);
  }
});

test("SQLite baseline creates production query indexes", () => {
  const allMigrations = readAllMigrations("prisma/migrations");
  assert.match(allMigrations, /CREATE INDEX "Article_visibility_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX "Article_category_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX "Article_level_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX IF NOT EXISTS "Article_public_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX IF NOT EXISTS "Article_public_category_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX IF NOT EXISTS "Article_public_level_feed_idx"/);
  assert.match(allMigrations, /CREATE INDEX "SavedWord_user_created_idx"/);
  assert.match(allMigrations, /CREATE INDEX "ReadingProgress_user_completedAt_idx"/);
});

test("PostgreSQL migrations create the same production query indexes", () => {
  const migration = readAllMigrations("prisma/postgresql/migrations");

  assert.match(migration, /CREATE INDEX(?: IF NOT EXISTS)? "Article_visibility_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_public_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_public_category_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_public_level_feed_idx"/);
  assert.match(migration, /CREATE INDEX(?: IF NOT EXISTS)? "Article_level_feed_idx"/);
  assert.match(migration, /CREATE INDEX(?: IF NOT EXISTS)? "Highlight_user_created_idx"/);
  assert.match(migration, /CREATE INDEX(?: IF NOT EXISTS)? "SavedWord_user_created_idx"/);
  assert.match(migration, /CREATE INDEX(?: IF NOT EXISTS)? "ReadingProgress_user_completedAt_idx"/);
});

test("public feed predicate matches ownerless partial-index contract", () => {
  const articleAccess = read("src/lib/article-access.ts");
  const docs = read("docs/search-and-indexing.md");
  const migration = readAllMigrations("prisma/postgresql/migrations");

  assert.match(articleAccess, /publicListableArticleWhere[\s\S]{0,250}ownerId:\s*null/);
  assert.match(docs, /ownerId IS NULL/);
  assert.match(migration, /"ownerId" IS NULL/);
});

test("search strategy docs capture scaling assumptions and PostgreSQL follow-up", () => {
  const docs = read("docs/search-and-indexing.md");
  assert.match(docs, /ArticleSearchProvider/);
  assert.match(docs, /Article_search_vector_idx/);
  assert.match(docs, /Core query-plan evidence \(#263\)/);
  assert.match(docs, /Worker \/ processor/);
  assert.match(docs, /Learner analytics/);
  assert.match(docs, /Query-plan checklist/);
  assert.match(docs, /Closes #263/);
  assert.match(docs, /Refs #259 #314/);
});
