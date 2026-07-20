-- PostgreSQL migration for Phase 3.4 annotation re-anchoring + derived-output
-- regeneration after an audited force-rescrape (#1103).
--
-- Adds two SECRET-FREE metadata columns to ArticleContentVersion so a BLOCKED
-- activation can expose the reader anchors that could NOT be reliably re-anchored
-- onto the proposed content, for operator/user confirmation, WITHOUT dropping
-- them:
--   - unresolvedAnchorCount: how many highlight/note anchors were missing or
--     ambiguous (repeated text / non-unique context) against the proposed
--     replacement. The annotation-migration gate blocks activation while this is
--     > 0, retaining the current ACTIVE version.
--   - unresolvedAnchorIds: the Highlight IDs of those anchors — IDENTIFIERS ONLY,
--     so the force-rescrape status endpoint can surface exactly which highlights
--     need confirmation. It NEVER stores the quote text, note text, article
--     content, prompt, or translation of any annotation.
-- Both are nullable and additive; Json is stored as JSONB. The actual anchor
-- OFFSET migration + derived-output regeneration are DATA operations (highlight
-- updates, cache clears, deduplicated jobs) that need no schema change.

-- AlterTable
ALTER TABLE "ArticleContentVersion" ADD COLUMN "unresolvedAnchorCount" INTEGER;
ALTER TABLE "ArticleContentVersion" ADD COLUMN "unresolvedAnchorIds" JSONB;
