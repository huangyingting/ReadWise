-- SQLite migration for Phase 2.9 credentialRef-based authenticated provider
-- ingestion (#1099).
--
-- Adds two SECRET-FREE metadata columns to DiscoverySource:
--   - credentialRef: a stable NAME/handle (env-var key or secret-store key) the
--     worker resolves to a live credential IN MEMORY at request time. It is
--     NEVER the secret value, a token, a signed URL, or an Authorization header.
--     Rotating the secret behind a fixed credentialRef needs NO candidate/job
--     rewrite.
--   - authIdentityKind: how this source's items are identified. Only a stable,
--     secret-free identity may be activated for automatic incremental ingestion;
--     a source identified ONLY by rotating signed URLs is refused activation.
-- Both are nullable (no default / NOT NULL needed) and additive.

-- AlterTable
ALTER TABLE "DiscoverySource" ADD COLUMN "credentialRef" TEXT;
ALTER TABLE "DiscoverySource" ADD COLUMN "authIdentityKind" TEXT;
