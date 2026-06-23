process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
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
    "SavedWord_due_idx",
    "ReadingProgress_user_completed_updated_idx",
    "ReadingProgress_article_idx",
    "Highlight_user_created_idx",
    "User_role_created_idx",
  ]) {
    assert.match(schema, new RegExp(`map: "${indexName}"`), `${indexName} missing from schema`);
  }
});

test("search index migration removes SQLite FTS5 and creates production query indexes", () => {
  const migrationDirs = readdirSync(join(ROOT, "prisma/migrations"));
  const searchMigration = migrationDirs.find((dir) => dir.endsWith("_search_indexes"));
  assert.ok(searchMigration, "search_indexes migration missing");
  const migration = read(`prisma/migrations/${searchMigration}/migration.sql`);

  assert.match(migration, /DROP TABLE IF EXISTS "article_fts"/);
  assert.match(migration, /DROP TRIGGER IF EXISTS article_ai/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_visibility_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "SavedWord_due_idx"/);
});

test("PostgreSQL search index migration creates the same production query indexes", () => {
  const migration = read("prisma/postgresql/migrations/20260623004500_search_indexes/migration.sql");

  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_visibility_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Article_level_feed_idx"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "Highlight_user_created_idx"/);
});

test("search strategy docs capture scaling assumptions and PostgreSQL follow-up", () => {
  const docs = read("docs/search-and-indexing.md");
  assert.match(docs, /ArticleSearchProvider/);
  assert.match(docs, /PostgreSQL full-text search after #259/);
  assert.match(docs, /Query-plan checklist/);
});
