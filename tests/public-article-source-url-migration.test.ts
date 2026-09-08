import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

type Statement = {
  all: () => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => unknown;
};

type Database = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  close: () => void;
};

type DatabaseConstructor = new (path: string) => Database;

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3") as DatabaseConstructor;
const sqliteMigration = readFileSync(
  new URL(
    "../prisma/migrations/20260722080000_unique_public_article_source_url/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const postgresMigration = readFileSync(
  new URL(
    "../prisma/postgresql/migrations/20260722080000_unique_public_article_source_url/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("public source URL migration preserves organization article URLs", () => {
  const db = new BetterSqlite(":memory:");
  try {
    db.exec(`
      CREATE TABLE "Article" (
        "id" TEXT PRIMARY KEY,
        "ownerId" TEXT,
        "organizationId" TEXT,
        "visibility" TEXT NOT NULL,
        "sourceUrl" TEXT,
        "createdAt" TEXT NOT NULL
      );
      INSERT INTO "Article" VALUES
        ('org', NULL, 'org-1', 'ORG', 'https://example.test/shared', '2026-01-01'),
        ('public-old', NULL, NULL, 'PUBLIC', 'https://example.test/shared', '2026-01-02'),
        ('public-new', NULL, NULL, 'PUBLIC', 'https://example.test/shared', '2026-01-03');
    `);

    db.exec(sqliteMigration);

    const rows = db
      .prepare(
        `SELECT "id", "sourceUrl" FROM "Article" ORDER BY "createdAt" ASC`,
      )
      .all();
    assert.deepEqual(rows, [
      { id: "org", sourceUrl: "https://example.test/shared" },
      { id: "public-old", sourceUrl: "https://example.test/shared" },
      { id: "public-new", sourceUrl: null },
    ]);

    db.prepare(
      `INSERT INTO "Article" VALUES (?, NULL, ?, 'ORG', ?, ?)`,
    ).run(
      "org-2",
      "org-2",
      "https://example.test/shared",
      "2026-01-04",
    );
    assert.throws(() =>
      db.prepare(
        `INSERT INTO "Article" VALUES (?, NULL, NULL, 'PUBLIC', ?, ?)`,
      ).run(
        "public-conflict",
        "https://example.test/shared",
        "2026-01-05",
      ),
    );
  } finally {
    db.close();
  }
});

test("both provider migrations scope uniqueness to the global public library", () => {
  for (const migration of [sqliteMigration, postgresMigration]) {
    assert.match(migration, /"organizationId" IS NULL/);
    assert.match(migration, /"visibility" IN \('PUBLIC', 'UNLISTED'\)/);
  }
});
