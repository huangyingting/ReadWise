-- Replace the plain @@index([sourceUrl]) with a compound @@unique([sourceUrl, ownerId]).
-- SQLite cannot ALTER a table to add a constraint, so the table is redefined.
-- The FTS5 virtual table + triggers depend on "Article" and are dropped/recreated.
-- NOTE: SQLite treats NULL as distinct in unique indexes, so rows with a NULL
-- sourceUrl (or NULL ownerId) are NOT constrained — only (non-null url, owner)
-- pairs are de-duplicated, which is the intended per-(url, owner) dedup.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Drop triggers that reference the old Article table (recreated below).
DROP TRIGGER IF EXISTS article_ai;
DROP TRIGGER IF EXISTS article_ad;
DROP TRIGGER IF EXISTS article_au;
-- Drop the FTS virtual table so it can be recreated against the new Article table.
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
    "status" TEXT NOT NULL DEFAULT 'published',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    CONSTRAINT "Article_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("author", "category", "content", "createdAt", "difficulty", "difficultyScore", "excerpt", "heroImage", "id", "ownerId", "publishedAt", "readingMinutes", "slug", "source", "sourceUrl", "status", "title", "updatedAt", "wordCount") SELECT "author", "category", "content", "createdAt", "difficulty", "difficultyScore", "excerpt", "heroImage", "id", "ownerId", "publishedAt", "readingMinutes", "slug", "source", "sourceUrl", "status", "title", "updatedAt", "wordCount" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_category_idx" ON "Article"("category");
CREATE INDEX "Article_ownerId_idx" ON "Article"("ownerId");
CREATE UNIQUE INDEX "Article_sourceUrl_ownerId_key" ON "Article"("sourceUrl", "ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Recreate the FTS5 virtual table against the new Article table.
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

-- Backfill the FTS index from existing public articles.
INSERT INTO article_fts(rowid, title, excerpt, content)
SELECT rowid, title, COALESCE(excerpt, ''), COALESCE(content, '')
FROM "Article"
WHERE status = 'published' AND ownerId IS NULL;
