-- FTS5 virtual table for full-text search over article title, excerpt, and content.
-- The table is an "external content" FTS5 table: it stores no content itself but
-- reads from the "Article" base table via the content= option, keeping storage
-- compact and the index always consistent with the source row.

CREATE VIRTUAL TABLE IF NOT EXISTS "article_fts" USING fts5(
  title,
  excerpt,
  content,
  content="Article",
  content_rowid="rowid",
  tokenize="unicode61 remove_diacritics 1"
);

-- Triggers to keep the FTS index in sync with the Article table.

-- INSERT: add new row to the FTS index.
CREATE TRIGGER IF NOT EXISTS article_ai
AFTER INSERT ON "Article" BEGIN
  INSERT INTO article_fts(rowid, title, excerpt, content)
  VALUES (new.rowid, new.title, COALESCE(new.excerpt, ''), COALESCE(new.content, ''));
END;

-- DELETE: remove the old row from the FTS index.
CREATE TRIGGER IF NOT EXISTS article_ad
AFTER DELETE ON "Article" BEGIN
  INSERT INTO article_fts(article_fts, rowid, title, excerpt, content)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.excerpt, ''), COALESCE(old.content, ''));
END;

-- UPDATE: remove the old row and insert the new row (external content FTS5 update pattern).
CREATE TRIGGER IF NOT EXISTS article_au
AFTER UPDATE ON "Article" BEGIN
  INSERT INTO article_fts(article_fts, rowid, title, excerpt, content)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.excerpt, ''), COALESCE(old.content, ''));
  INSERT INTO article_fts(rowid, title, excerpt, content)
  VALUES (new.rowid, new.title, COALESCE(new.excerpt, ''), COALESCE(new.content, ''));
END;

-- Backfill: populate the FTS index from all existing published articles.
INSERT INTO article_fts(rowid, title, excerpt, content)
SELECT rowid, title, COALESCE(excerpt, ''), COALESCE(content, '')
FROM "Article"
WHERE status = 'published';