import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260623004100_json_field_cleanup/migration.sql",
  ),
  "utf8",
);

const sqliteAvailable =
  spawnSync("sqlite3", ["-version"], { encoding: "utf8" }).status === 0;

function sqliteTest(name: string, fn: () => void) {
  if (!sqliteAvailable) {
    test(name, { skip: "sqlite3 CLI is required for migration SQL verification" }, () => {});
    return;
  }

  test(name, fn);
}

function runSql(sql: string) {
  return spawnSync("sqlite3", [":memory:"], {
    input: `.bail on\n${sql}`,
    encoding: "utf8",
  });
}

function extractRequiredSnippet(start: string, end: string) {
  const startIndex = migrationSql.indexOf(start);
  const endIndex = migrationSql.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing SQL start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing SQL end marker: ${end}`);
  return migrationSql.slice(startIndex, endIndex).trim();
}

sqliteTest("JSON cleanup migration gives fresh Profile rows a valid empty topics array", () => {
  const createProfile = extractRequiredSnippet(
    'CREATE TABLE "new_Profile"',
    'INSERT INTO "new_Profile"',
  );

  const result = runSql(`
${createProfile}
INSERT INTO "new_Profile" ("id", "userId", "englishLevel", "updatedAt")
VALUES ('profile-1', 'user-1', 'B1', CURRENT_TIMESTAMP);
SELECT json_valid("topics") || '|' || json_type("topics") || '|' || quote("topics")
FROM "new_Profile";
`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1|array|'[]'");
});

sqliteTest("JSON cleanup migration rejects ArticleSpeech word entries missing required fields", () => {
  const validationSql = extractRequiredSnippet(
    'CREATE TABLE "_JsonFieldMigrationInvalid"',
    "PRAGMA defer_foreign_keys=ON;",
  );

  const result = runSql(`
CREATE TABLE "Profile" ("id" TEXT NOT NULL, "topics" TEXT NOT NULL);
CREATE TABLE "QuizQuestion" ("id" TEXT NOT NULL, "options" TEXT NOT NULL);
CREATE TABLE "ArticleSpeech" ("id" TEXT NOT NULL, "words" TEXT NOT NULL);

INSERT INTO "Profile" ("id", "topics") VALUES ('profile-1', '[]');
INSERT INTO "QuizQuestion" ("id", "options") VALUES ('quiz-1', '["Yes","No"]');
INSERT INTO "ArticleSpeech" ("id", "words")
VALUES ('speech-1', '[{"textOffset":0,"length":4,"start":0.1}]');

${validationSql}
`);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /JSON field migration aborted: malformed or invalid existing JSON string/,
  );
});
