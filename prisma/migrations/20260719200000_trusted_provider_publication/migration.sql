-- SQLite migration for Phase 2.6 trusted-provider auto-publication gate (#1096).
--
-- Adds three INDEPENDENT, DEFAULT-FALSE permission flags to DiscoverySource.
-- They are deliberately separate: authenticated-fetch permission never implies
-- public republication, and neither implies auto-publication trust.
--   - canFetchAuthenticated: may fetch the source with credentials (access only).
--   - canRepublishPublicly: may republish the source's content publicly (rights).
--   - autoPublishTrusted: explicit trust to auto-publish validated drafts without
--     human review (requires canRepublishPublicly too; never granted by fetch).
--
-- METADATA ONLY: booleans; never a credential, cookie, URL, or article content.

-- AlterTable
ALTER TABLE "DiscoverySource" ADD COLUMN "canFetchAuthenticated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscoverySource" ADD COLUMN "canRepublishPublicly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DiscoverySource" ADD COLUMN "autoPublishTrusted" BOOLEAN NOT NULL DEFAULT false;
