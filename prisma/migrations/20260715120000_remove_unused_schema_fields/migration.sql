-- Remove write-only placeholders and metadata duplicated by canonical rows.
ALTER TABLE "Profile" DROP COLUMN "levelUpdatedAt";
ALTER TABLE "Tag" DROP COLUMN "orgId";
ALTER TABLE "ArticleTag" DROP COLUMN "createdAt";
ALTER TABLE "ArticleSpeech" DROP COLUMN "format";
ALTER TABLE "ArticleSpeech" DROP COLUMN "mimeType";
ALTER TABLE "ArticleSpeech" DROP COLUMN "storageKey";
ALTER TABLE "ArticleSpeech" DROP COLUMN "mediaAssetId";
ALTER TABLE "SentenceTranslation" DROP COLUMN "sourceText";
ALTER TABLE "SkillMastery" DROP COLUMN "lastUpdatedAt";
ALTER TABLE "MediaAsset" DROP COLUMN "sizeBytes";
ALTER TABLE "MediaAsset" DROP COLUMN "checksum";
ALTER TABLE "MediaAsset" DROP COLUMN "durationSec";
ALTER TABLE "MediaAsset" DROP COLUMN "format";
ALTER TABLE "Organization" DROP COLUMN "settings";

-- Old storage-key upserts could leave multiple speech assets for one article.
-- Keep the most recently updated row before enforcing the canonical owner key.
DELETE FROM "MediaAsset"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "articleId", "kind"
        ORDER BY "updatedAt" DESC, "id" DESC
      ) AS "row_rank"
    FROM "MediaAsset"
    WHERE "articleId" IS NOT NULL
  ) AS "ranked_assets"
  WHERE "row_rank" > 1
);

-- A speech asset belongs to one article; the object key remains globally unique.
CREATE UNIQUE INDEX "MediaAsset_articleId_kind_key" ON "MediaAsset"("articleId", "kind");
