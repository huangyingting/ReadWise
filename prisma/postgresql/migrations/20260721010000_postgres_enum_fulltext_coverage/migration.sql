-- PostgreSQL forward-coverage migration for CrawlCandidateStatus enum labels
-- and article full-text search indexing (#1176, #1177).
--
-- Some deployed databases may have applied the earlier logical migrations before
-- their PostgreSQL-specific enum/index SQL was added. Keep this migration
-- idempotent so fresh databases (where earlier migrations already add these
-- values and the baseline already creates the index) and existing databases both
-- converge safely.
--
-- NOTE: PostgreSQL enum additions must remain standalone statements; do not wrap
-- this migration in BEGIN/COMMIT. This matches the established PostgreSQL
-- migration precedent for CrawlCandidateStatus/Role enum extensions.

-- AlterEnum
ALTER TYPE "CrawlCandidateStatus" ADD VALUE IF NOT EXISTS 'QUARANTINED';
ALTER TYPE "CrawlCandidateStatus" ADD VALUE IF NOT EXISTS 'SKIPPED_REVIEW';
ALTER TYPE "CrawlCandidateStatus" ADD VALUE IF NOT EXISTS 'SKIPPED_OUTSIDE_WINDOW';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Article_search_vector_idx" ON "Article"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("excerpt", '') || ' ' || coalesce("content", '')));
