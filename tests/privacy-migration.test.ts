import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function runPrivacyMigrationFixture(): Record<string, number> {
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/20260623004106_privacy_article_model/migration.sql"),
    "utf8",
  );
  const sql = `
PRAGMA foreign_keys=ON;

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY
);

CREATE TABLE "Article" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT,
  "title" TEXT NOT NULL,
  "author" TEXT,
  "source" TEXT,
  "sourceUrl" TEXT,
  "heroImage" TEXT,
  "excerpt" TEXT,
  "content" TEXT NOT NULL,
  "category" TEXT,
  "wordCount" INTEGER,
  "readingMinutes" INTEGER,
  "difficulty" TEXT,
  "difficultyScore" REAL,
  "status" TEXT NOT NULL DEFAULT 'published',
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "ownerId" TEXT,
  CONSTRAINT "Article_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Tag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ArticleTag" (
  "articleId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("articleId", "tagId"),
  CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE UNIQUE INDEX "Article_sourceUrl_ownerId_key" ON "Article"("sourceUrl", "ownerId");
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

INSERT INTO "User" ("id") VALUES ('user-1'), ('user-2');

INSERT INTO "Article" (
  "id", "slug", "title", "content", "status", "createdAt", "updatedAt", "ownerId"
) VALUES
  ('public-a', 'public-a', 'Public article', '<p>Public</p>', 'published', '2026-01-01', '2026-01-01', NULL),
  ('private-a1', 'private-a1', 'Private article 1', '<p>Private</p>', 'published', '2026-01-01', '2026-01-01', 'user-1'),
  ('private-a2', 'private-a2', 'Private article 2', '<p>Private</p>', 'published', '2026-01-01', '2026-01-01', 'user-2');

INSERT INTO "Tag" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
  ('tag-shared', 'Shared', 'shared', '2026-01-01', '2026-01-01'),
  ('tag-secret', 'Secret Import', 'secret-import', '2026-01-01', '2026-01-01'),
  ('tag-personal', 'Personal Notes', 'personal-notes', '2026-01-01', '2026-01-01'),
  ('tag-orphan', 'Curated Empty', 'curated-empty', '2026-01-01', '2026-01-01');

INSERT INTO "ArticleTag" ("articleId", "tagId") VALUES
  ('public-a', 'tag-shared'),
  ('private-a1', 'tag-shared'),
  ('private-a1', 'tag-secret'),
  ('private-a1', 'tag-personal'),
  ('private-a2', 'tag-secret');

${migration}

CREATE TEMP TABLE "assertions" ("key" TEXT NOT NULL PRIMARY KEY, "value" INTEGER NOT NULL);

INSERT INTO "assertions" VALUES
  ('publicSharedTags', (SELECT COUNT(*) FROM "Tag" WHERE "slug" = 'shared' AND "scope" = 'PUBLIC' AND "namespace" = 'public' AND "ownerId" IS NULL)),
  ('publicOrphanTags', (SELECT COUNT(*) FROM "Tag" WHERE "slug" = 'curated-empty' AND "scope" = 'PUBLIC' AND "namespace" = 'public' AND "ownerId" IS NULL)),
  ('publicPrivateOnlyTags', (SELECT COUNT(*) FROM "Tag" WHERE "scope" = 'PUBLIC' AND "slug" IN ('secret-import', 'personal-notes'))),
  ('user1PrivateTags', (SELECT COUNT(*) FROM "Tag" WHERE "scope" = 'PRIVATE' AND "namespace" = 'user:user-1' AND "ownerId" = 'user-1')),
  ('user2PrivateTags', (SELECT COUNT(*) FROM "Tag" WHERE "scope" = 'PRIVATE' AND "namespace" = 'user:user-2' AND "ownerId" = 'user-2')),
  ('privateWrongScopeLinks', (
    SELECT COUNT(*)
    FROM "ArticleTag" AS "at"
    JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
    JOIN "Tag" AS "t" ON "t"."id" = "at"."tagId"
    WHERE "a"."ownerId" IS NOT NULL
      AND ("t"."scope" != 'PRIVATE' OR "t"."namespace" != 'user:' || "a"."ownerId" OR "t"."ownerId" != "a"."ownerId")
  )),
  ('publicWrongScopeLinks', (
    SELECT COUNT(*)
    FROM "ArticleTag" AS "at"
    JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
    JOIN "Tag" AS "t" ON "t"."id" = "at"."tagId"
    WHERE "a"."ownerId" IS NULL
      AND ("t"."scope" != 'PUBLIC' OR "t"."namespace" != 'public' OR "t"."ownerId" IS NOT NULL)
  )),
  ('foreignKeyViolationsBeforeDelete', (SELECT COUNT(*) FROM pragma_foreign_key_check));

DELETE FROM "User" WHERE "id" = 'user-1';

INSERT INTO "assertions" VALUES
  ('user1PrivateTagsAfterDelete', (SELECT COUNT(*) FROM "Tag" WHERE "ownerId" = 'user-1')),
  ('user1PrivateArticlesAfterDelete', (SELECT COUNT(*) FROM "Article" WHERE "ownerId" = 'user-1')),
  ('user1PrivateLinksAfterDelete', (
    SELECT COUNT(*)
    FROM "ArticleTag" AS "at"
    LEFT JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
    LEFT JOIN "Tag" AS "t" ON "t"."id" = "at"."tagId"
    WHERE "a"."id" IS NULL OR "t"."id" IS NULL OR "t"."ownerId" = 'user-1'
  )),
  ('publicSharedTagsAfterDelete', (SELECT COUNT(*) FROM "Tag" WHERE "slug" = 'shared' AND "scope" = 'PUBLIC')),
  ('user2SecretTagsAfterDelete', (SELECT COUNT(*) FROM "Tag" WHERE "slug" = 'secret-import' AND "ownerId" = 'user-2')),
  ('foreignKeyViolationsAfterDelete', (SELECT COUNT(*) FROM pragma_foreign_key_check));

SELECT json_group_object("key", "value") FROM "assertions";
`;

  const output = execFileSync("sqlite3", [":memory:"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();
  return JSON.parse(output) as Record<string, number>;
}

test("privacy migration scopes existing private article tags and owner cleanup cascades", () => {
  const result = runPrivacyMigrationFixture();

  assert.equal(result.publicSharedTags, 1);
  assert.equal(result.publicOrphanTags, 1);
  assert.equal(result.publicPrivateOnlyTags, 0);
  assert.equal(result.user1PrivateTags, 3);
  assert.equal(result.user2PrivateTags, 1);
  assert.equal(result.privateWrongScopeLinks, 0);
  assert.equal(result.publicWrongScopeLinks, 0);
  assert.equal(result.foreignKeyViolationsBeforeDelete, 0);
  assert.equal(result.user1PrivateTagsAfterDelete, 0);
  assert.equal(result.user1PrivateArticlesAfterDelete, 0);
  assert.equal(result.user1PrivateLinksAfterDelete, 0);
  assert.equal(result.publicSharedTagsAfterDelete, 1);
  assert.equal(result.user2SecretTagsAfterDelete, 1);
  assert.equal(result.foreignKeyViolationsAfterDelete, 0);
});
