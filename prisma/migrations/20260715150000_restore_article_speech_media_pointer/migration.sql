-- Keep one MediaAsset row per stored object and explicitly identify the asset
-- whose audio corresponds to the current ArticleSpeech timings.
PRAGMA defer_foreign_keys=ON;

CREATE TABLE "new_ArticleSpeech" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "words" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleSpeech_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleSpeech_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ArticleSpeech" (
    "id", "articleId", "mediaAssetId", "words", "createdAt", "updatedAt"
)
SELECT
    speech."id",
    speech."articleId",
    (
        SELECT asset."id"
        FROM "MediaAsset" AS asset
        WHERE asset."articleId" = speech."articleId"
          AND asset."kind" = 'speech'
        ORDER BY asset."updatedAt" DESC, asset."id" DESC
        LIMIT 1
    ),
    speech."words",
    speech."createdAt",
    speech."updatedAt"
FROM "ArticleSpeech" AS speech;

DROP TABLE "ArticleSpeech";
ALTER TABLE "new_ArticleSpeech" RENAME TO "ArticleSpeech";

CREATE UNIQUE INDEX "ArticleSpeech_articleId_key" ON "ArticleSpeech"("articleId");
CREATE UNIQUE INDEX "ArticleSpeech_mediaAssetId_key" ON "ArticleSpeech"("mediaAssetId");
DROP INDEX "MediaAsset_articleId_kind_key";
