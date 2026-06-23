-- Add explicit article visibility/status/source-type semantics and scoped tag namespaces.
-- Existing ownerId=NULL library rows become PUBLIC/SCRAPED; existing ownerId!=NULL imports become PRIVATE/IMPORTED.
-- Private article ownership is now database-enforced via ON DELETE CASCADE plus a CHECK that PRIVATE rows have an owner.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- FTS triggers reference Article and must be recreated after redefining the table.
DROP TRIGGER IF EXISTS article_ai;
DROP TRIGGER IF EXISTS article_ad;
DROP TRIGGER IF EXISTS article_au;
DROP TABLE IF EXISTS "article_fts";

CREATE TABLE "new_Article" (
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
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'published',
    "sourceType" TEXT NOT NULL DEFAULT 'SCRAPED',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    CONSTRAINT "Article_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Article_private_owner_check" CHECK ("visibility" != 'PRIVATE' OR "ownerId" IS NOT NULL),
    CONSTRAINT "Article_owner_visibility_check" CHECK ("ownerId" IS NULL OR "visibility" = 'PRIVATE')
);

INSERT INTO "new_Article" (
    "author", "category", "content", "createdAt", "difficulty", "difficultyScore",
    "excerpt", "heroImage", "id", "ownerId", "publishedAt", "readingMinutes",
    "slug", "source", "sourceUrl", "status", "title", "updatedAt", "wordCount",
    "visibility", "sourceType"
)
SELECT
    "author", "category", "content", "createdAt", "difficulty", "difficultyScore",
    "excerpt", "heroImage", "id", "ownerId", "publishedAt", "readingMinutes",
    "slug", "source", "sourceUrl", "status", "title", "updatedAt", "wordCount",
    CASE WHEN "ownerId" IS NULL THEN 'PUBLIC' ELSE 'PRIVATE' END,
    CASE WHEN "ownerId" IS NULL THEN 'SCRAPED' ELSE 'IMPORTED' END
FROM "Article";

DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_category_idx" ON "Article"("category");
CREATE INDEX "Article_ownerId_idx" ON "Article"("ownerId");
CREATE INDEX "Article_visibility_status_idx" ON "Article"("visibility", "status");
CREATE UNIQUE INDEX "Article_sourceUrl_ownerId_key" ON "Article"("sourceUrl", "ownerId");

CREATE TABLE "new_Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PUBLIC',
    "namespace" TEXT NOT NULL DEFAULT 'public',
    "ownerId" TEXT,
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Tag" (
    "id", "name", "slug", "createdAt", "updatedAt", "scope", "namespace", "ownerId", "orgId"
)
SELECT "id", "name", "slug", "createdAt", "updatedAt", 'PUBLIC', 'public', NULL, NULL
FROM "Tag";

DROP TABLE "Tag";
ALTER TABLE "new_Tag" RENAME TO "Tag";
CREATE UNIQUE INDEX "Tag_scope_namespace_slug_key" ON "Tag"("scope", "namespace", "slug");
CREATE INDEX "Tag_scope_namespace_idx" ON "Tag"("scope", "namespace");
CREATE INDEX "Tag_ownerId_idx" ON "Tag"("ownerId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE VIRTUAL TABLE IF NOT EXISTS "article_fts" USING fts5(
  title,
  excerpt,
  content,
  content="Article",
  content_rowid="rowid",
  tokenize="unicode61 remove_diacritics 1"
);

CREATE TRIGGER IF NOT EXISTS article_ai
AFTER INSERT ON "Article" BEGIN
  INSERT INTO article_fts(rowid, title, excerpt, content)
  VALUES (new.rowid, new.title, COALESCE(new.excerpt, ''), COALESCE(new.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS article_ad
AFTER DELETE ON "Article" BEGIN
  INSERT INTO article_fts(article_fts, rowid, title, excerpt, content)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.excerpt, ''), COALESCE(old.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS article_au
AFTER UPDATE ON "Article" BEGIN
  INSERT INTO article_fts(article_fts, rowid, title, excerpt, content)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.excerpt, ''), COALESCE(old.content, ''));
  INSERT INTO article_fts(rowid, title, excerpt, content)
  VALUES (new.rowid, new.title, COALESCE(new.excerpt, ''), COALESCE(new.content, ''));
END;

INSERT INTO article_fts(rowid, title, excerpt, content)
SELECT rowid, title, COALESCE(excerpt, ''), COALESCE(content, '')
FROM "Article"
WHERE visibility = 'PUBLIC' AND status = 'published';
