-- PostgreSQL counterpart to the portable search/index migration. SQLite-only
-- FTS5 drops are intentionally omitted; the PostgreSQL Article_search_vector_idx
-- remains in the baseline migration.
CREATE INDEX IF NOT EXISTS "User_role_created_idx" ON "User"("role", "createdAt");

CREATE INDEX IF NOT EXISTS "Article_sourceUrl_idx" ON "Article"("sourceUrl");
CREATE INDEX IF NOT EXISTS "Article_visibility_feed_idx" ON "Article"("status", "ownerId", "publishedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_category_feed_idx" ON "Article"("status", "ownerId", "category", "publishedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_owner_status_created_idx" ON "Article"("ownerId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_status_created_idx" ON "Article"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_level_feed_idx" ON "Article"("status", "ownerId", "difficulty", "difficultyScore", "publishedAt");

CREATE INDEX IF NOT EXISTS "SavedWord_user_article_idx" ON "SavedWord"("userId", "articleId");
CREATE INDEX IF NOT EXISTS "SavedWord_due_idx" ON "SavedWord"("userId", "dueAt");

CREATE INDEX IF NOT EXISTS "ReadingProgress_user_completed_updated_idx" ON "ReadingProgress"("userId", "completed", "updatedAt");
CREATE INDEX IF NOT EXISTS "ReadingProgress_article_idx" ON "ReadingProgress"("articleId");

CREATE INDEX IF NOT EXISTS "Account_user_idx" ON "Account"("userId");
CREATE INDEX IF NOT EXISTS "Session_user_idx" ON "Session"("userId");

CREATE INDEX IF NOT EXISTS "Highlight_user_created_idx" ON "Highlight"("userId", "createdAt");
