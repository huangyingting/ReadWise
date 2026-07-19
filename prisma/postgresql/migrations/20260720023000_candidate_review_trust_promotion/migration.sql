-- PostgreSQL migration for Phase 3.1 candidate review & explicit source trust
-- promotion (#1100).
--
-- Adds the SKIPPED_REVIEW terminal CrawlCandidateStatus recorded when an
-- authorized operator EXPLICITLY rejects a NEEDS_REVIEW candidate. It is a
-- no-Article resting state that ordinary rediscovery/ingest never re-enqueues
-- (governing invariant); only the separate audited reactivate action returns it
-- to NEEDS_REVIEW. No column, index, or content change accompanies it — source
-- trust promotion reuses the existing (already version-scoped) DiscoverySource
-- `autoPublishTrusted` flag, and every review/promotion record lives in the
-- audit log, so no schema addition is required here.
--
-- NOTE: PostgreSQL cannot add an enum value inside a transaction, so the
-- ALTER TYPE runs as a STANDALONE statement (matching the #1093 precedent).

-- AlterEnum
ALTER TYPE "CrawlCandidateStatus" ADD VALUE 'SKIPPED_REVIEW';
