-- PostgreSQL migration for Phase 3.2 SKIPPED_OUTSIDE_WINDOW persistence +
-- backfill reactivation (#1127).
--
-- Adds the SKIPPED_OUTSIDE_WINDOW inert CrawlCandidateStatus persisted by normal
-- incremental page-commit when an ACTIVE-source item is admitted + dated but its
-- trusted publication date falls at/before the active discovery window. It is a
-- no-Article resting state that ordinary rediscovery/ingest NEVER auto-enqueues
-- (governing invariant, same as SKIPPED_REVIEW); only an operator-approved,
-- windowed backfill may reactivate it (articleId null AND articleDeletedAt null).
-- No column, index, or content change accompanies it — the candidate reuses the
-- existing providerKey/identityVersion/provisionalKey/trustedPublishedAt/
-- dateProvenance fields already on CrawlCandidate.
--
-- NOTE: PostgreSQL cannot add an enum value inside a transaction, so the
-- ALTER TYPE runs as a STANDALONE statement (matching the #1093/#1100 precedent).

-- AlterEnum
ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'SKIPPED_OUTSIDE_WINDOW';
