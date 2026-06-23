-- Additional query-plan evidence indexes for #263.
-- Public feed/category/recommendation plans include visibility in the leading
-- equality predicates; study pages sort a learner's saved words newest-first;
-- learner analytics bucket completed reads by completedAt. Keep these explicit
-- names in docs and regression tests.
DROP INDEX IF EXISTS "Article_visibility_status_idx";
DROP INDEX IF EXISTS "Article_visibility_feed_idx";
DROP INDEX IF EXISTS "Article_category_feed_idx";
DROP INDEX IF EXISTS "Article_level_feed_idx";

CREATE INDEX IF NOT EXISTS "Article_visibility_feed_idx" ON "Article"("visibility", "status", "ownerId", "publishedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_category_feed_idx" ON "Article"("visibility", "status", "ownerId", "category", "publishedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Article_level_feed_idx" ON "Article"("visibility", "status", "ownerId", "difficulty", "difficultyScore", "publishedAt");

CREATE INDEX IF NOT EXISTS "Article_public_feed_idx" ON "Article"("publishedAt", "createdAt")
  WHERE "visibility" = 'PUBLIC' AND "status" = 'published' AND "ownerId" IS NULL;
CREATE INDEX IF NOT EXISTS "Article_public_category_feed_idx" ON "Article"("category", "publishedAt", "createdAt")
  WHERE "visibility" = 'PUBLIC' AND "status" = 'published' AND "ownerId" IS NULL;
CREATE INDEX IF NOT EXISTS "Article_public_level_feed_idx" ON "Article"("difficulty", "difficultyScore", "publishedAt")
  WHERE "visibility" = 'PUBLIC' AND "status" = 'published' AND "ownerId" IS NULL;
CREATE INDEX IF NOT EXISTS "SavedWord_user_created_idx" ON "SavedWord"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ReadingProgress_user_completedAt_idx" ON "ReadingProgress"("userId", "completed", "completedAt");
