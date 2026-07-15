-- Keep one MediaAsset row per stored object and explicitly identify the asset
-- whose audio corresponds to the current ArticleSpeech timings.
ALTER TABLE "ArticleSpeech" ADD COLUMN "mediaAssetId" TEXT;

UPDATE "ArticleSpeech" AS speech
SET "mediaAssetId" = (
    SELECT asset."id"
    FROM "MediaAsset" AS asset
    WHERE asset."articleId" = speech."articleId"
      AND asset."kind" = 'speech'
    ORDER BY asset."updatedAt" DESC, asset."id" DESC
    LIMIT 1
);

CREATE UNIQUE INDEX "ArticleSpeech_mediaAssetId_key" ON "ArticleSpeech"("mediaAssetId");
DROP INDEX "MediaAsset_articleId_kind_key";

ALTER TABLE "ArticleSpeech"
ADD CONSTRAINT "ArticleSpeech_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
