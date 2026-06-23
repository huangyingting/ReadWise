-- Add explicit article visibility/status/source-type semantics and scoped tag namespaces.
-- Existing ownerId=NULL library rows become PUBLIC/SCRAPED; existing ownerId!=NULL imports become PRIVATE/IMPORTED.
-- Private article ownership is database-enforced via ON DELETE CASCADE plus CHECK constraints.

-- CreateEnum
CREATE TYPE "ArticleVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'UNLISTED', 'ORG');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'processing', 'published', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "ArticleSourceType" AS ENUM ('SCRAPED', 'IMPORTED', 'MANUAL', 'RSS', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "TagScope" AS ENUM ('PUBLIC', 'PRIVATE', 'ORG');

-- Alter Article status from text to enum and add privacy metadata.
ALTER TABLE "Article" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Article" ALTER COLUMN "status" TYPE "ArticleStatus" USING "status"::"ArticleStatus";
ALTER TABLE "Article" ALTER COLUMN "status" SET DEFAULT 'published';
ALTER TABLE "Article" ADD COLUMN "visibility" "ArticleVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Article" ADD COLUMN "sourceType" "ArticleSourceType" NOT NULL DEFAULT 'SCRAPED';

UPDATE "Article"
SET "visibility" = 'PRIVATE',
    "sourceType" = 'IMPORTED'
WHERE "ownerId" IS NOT NULL;

ALTER TABLE "Article" DROP CONSTRAINT "Article_ownerId_fkey";
ALTER TABLE "Article" ADD CONSTRAINT "Article_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_private_owner_check" CHECK ("visibility" != 'PRIVATE' OR "ownerId" IS NOT NULL);
ALTER TABLE "Article" ADD CONSTRAINT "Article_owner_visibility_check" CHECK ("ownerId" IS NULL OR "visibility" = 'PRIVATE');

CREATE INDEX "Article_visibility_status_idx" ON "Article"("visibility", "status");

-- Alter Tag from globally unique names/slugs to scoped namespaces.
ALTER TABLE "Tag" ADD COLUMN "scope" "TagScope" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Tag" ADD COLUMN "namespace" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "Tag" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Tag" ADD COLUMN "orgId" TEXT;

CREATE TEMP TABLE "_readwise_private_only_tags" AS
SELECT "t"."id"
FROM "Tag" AS "t"
WHERE EXISTS (
    SELECT 1
    FROM "ArticleTag" AS "at"
    JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
    WHERE "at"."tagId" = "t"."id"
      AND "a"."ownerId" IS NOT NULL
)
AND NOT EXISTS (
    SELECT 1
    FROM "ArticleTag" AS "at"
    JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
    WHERE "at"."tagId" = "t"."id"
      AND "a"."ownerId" IS NULL
);

DROP INDEX "Tag_name_key";
DROP INDEX "Tag_slug_key";

INSERT INTO "Tag" (
    "id", "name", "slug", "createdAt", "updatedAt", "scope", "namespace", "ownerId", "orgId"
)
SELECT
    "t"."id" || ':private:' || "a"."ownerId",
    "t"."name",
    "t"."slug",
    MIN("t"."createdAt"),
    MAX("t"."updatedAt"),
    'PRIVATE',
    'user:' || "a"."ownerId",
    "a"."ownerId",
    NULL
FROM "Tag" AS "t"
JOIN "ArticleTag" AS "at" ON "at"."tagId" = "t"."id"
JOIN "Article" AS "a" ON "a"."id" = "at"."articleId"
WHERE "a"."ownerId" IS NOT NULL
GROUP BY "t"."id", "t"."name", "t"."slug", "a"."ownerId";

UPDATE "ArticleTag" AS "at"
SET "tagId" = "at"."tagId" || ':private:' || "a"."ownerId"
FROM "Article" AS "a"
WHERE "a"."id" = "at"."articleId"
  AND "a"."ownerId" IS NOT NULL;

DELETE FROM "Tag" AS "t"
USING "_readwise_private_only_tags" AS "private_only"
WHERE "t"."id" = "private_only"."id";

DROP TABLE "_readwise_private_only_tags";

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Tag_scope_namespace_idx" ON "Tag"("scope", "namespace");
CREATE INDEX "Tag_ownerId_idx" ON "Tag"("ownerId");
CREATE UNIQUE INDEX "Tag_scope_namespace_slug_key" ON "Tag"("scope", "namespace", "slug");
