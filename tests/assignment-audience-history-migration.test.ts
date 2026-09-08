import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

type Statement = {
  all: () => Array<Record<string, unknown>>;
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
    "../prisma/migrations/20260722090000_assignment_audience_history/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const postgresMigration = readFileSync(
  new URL(
    "../prisma/postgresql/migrations/20260722090000_assignment_audience_history/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("assignment audience history migration preserves prior targeting", () => {
  const db = new BetterSqlite(":memory:");
  try {
    db.exec(`
      CREATE TABLE "Assignment" (
        "id" TEXT PRIMARY KEY,
        "wholeClass" BOOLEAN NOT NULL DEFAULT true
      );
      CREATE TABLE "AssignmentTarget" (
        "assignmentId" TEXT NOT NULL,
        "studentId" TEXT NOT NULL
      );
      CREATE TABLE "AssignmentCompletion" (
        "assignmentId" TEXT NOT NULL,
        "studentId" TEXT NOT NULL,
        "quizScore" INTEGER
      );
      INSERT INTO "Assignment" VALUES
        ('whole', true),
        ('targeted', false),
        ('legacy-target-row', true),
        ('previously-widened', true);
      INSERT INTO "AssignmentTarget" VALUES
        ('targeted', 'student-1'),
        ('legacy-target-row', 'student-2');
      INSERT INTO "AssignmentCompletion" VALUES
        ('previously-widened', 'student-3', 41);
    `);

    db.exec(sqliteMigration);

    const rows = db
      .prepare(
        `SELECT "id", "everTargeted" FROM "Assignment" ORDER BY "id" ASC`,
      )
      .all();
    assert.deepEqual(rows, [
      { id: "legacy-target-row", everTargeted: 1 },
      { id: "previously-widened", everTargeted: 1 },
      { id: "targeted", everTargeted: 1 },
      { id: "whole", everTargeted: 0 },
    ]);
  } finally {
    db.close();
  }
});

test("both provider migrations backfill immutable targeted-audience history", () => {
  for (const migration of [sqliteMigration, postgresMigration]) {
    assert.match(migration, /ADD COLUMN "everTargeted" BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migration, /WHERE "wholeClass" = false/);
    assert.match(migration, /FROM "AssignmentTarget"/);
    assert.match(migration, /FROM "AssignmentCompletion"/);
  }
});
