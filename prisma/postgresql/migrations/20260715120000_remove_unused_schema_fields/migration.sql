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

-- Keep the private-tag scoping trigger aligned with the reduced Tag shape.
CREATE OR REPLACE FUNCTION "rw_scope_article_tag"()
RETURNS TRIGGER AS $$
DECLARE
    article_owner TEXT;
    source_tag RECORD;
    scoped_tag_id TEXT;
BEGIN
    SELECT "ownerId" INTO article_owner
    FROM "Article"
    WHERE "id" = NEW."articleId";

    IF article_owner IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO source_tag
    FROM "Tag"
    WHERE "id" = NEW."tagId";

    IF source_tag."scope"::text = 'PRIVATE'
        AND source_tag."namespace" = 'user:' || article_owner
        AND source_tag."ownerId" = article_owner THEN
        RETURN NEW;
    END IF;

    scoped_tag_id := 'tag_private_' || md5(article_owner || ':' || source_tag."slug");

    INSERT INTO "Tag" (
        "id", "name", "slug", "scope", "namespace", "ownerId", "createdAt", "updatedAt"
    ) VALUES (
        scoped_tag_id,
        source_tag."name",
        source_tag."slug",
        'PRIVATE'::"TagScope",
        'user:' || article_owner,
        article_owner,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT ("scope", "namespace", "slug") DO UPDATE SET
        "name" = EXCLUDED."name",
        "ownerId" = EXCLUDED."ownerId",
        "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id" INTO scoped_tag_id;

    NEW."tagId" := scoped_tag_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
