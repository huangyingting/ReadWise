-- PostgreSQL migration: activate granular admin roles (#1155).
-- Adds three previously-planned global roles to the Role enum so they become
-- assignable via member management. Capability grants already exist in
-- src/lib/rbac.ts (ROLE_CAPABILITIES); this only makes the roles selectable.
--
-- NOTE: PostgreSQL cannot add an enum value inside a transaction, so each
-- ALTER TYPE runs as a STANDALONE statement (matching the #1093/#1100 precedent).

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'Moderator';
ALTER TYPE "Role" ADD VALUE 'ContentEditor';
ALTER TYPE "Role" ADD VALUE 'SupportAgent';
