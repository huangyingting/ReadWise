-- PostgreSQL migration for Phase 2.7 source activation-generation marker
-- (#1097).
--
-- Adds a monotonic `activationGeneration` counter to DiscoverySource. It is
-- INCREMENTED on every active->shadow rollback so a body-fetch job whose
-- pre-rollback generation snapshot predates the rollback fails closed at
-- Article commit even after a LATER re-activation (the re-activated source's
-- generation is strictly higher than the stale snapshot). Controlled counter;
-- never a URL, credential, or article content.

-- AlterTable
ALTER TABLE "DiscoverySource" ADD COLUMN "activationGeneration" INTEGER NOT NULL DEFAULT 0;
