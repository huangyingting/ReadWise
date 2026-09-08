UPDATE "Article" AS "duplicate"
SET "sourceUrl" = NULL
WHERE "duplicate"."ownerId" IS NULL
  AND "duplicate"."organizationId" IS NULL
  AND "duplicate"."visibility" IN ('PUBLIC', 'UNLISTED')
  AND "duplicate"."sourceUrl" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "Article" AS "canonical"
    WHERE "canonical"."ownerId" IS NULL
      AND "canonical"."organizationId" IS NULL
      AND "canonical"."visibility" IN ('PUBLIC', 'UNLISTED')
      AND "canonical"."sourceUrl" = "duplicate"."sourceUrl"
      AND (
        "canonical"."createdAt" < "duplicate"."createdAt"
        OR (
          "canonical"."createdAt" = "duplicate"."createdAt"
          AND "canonical"."id" < "duplicate"."id"
        )
      )
  );

CREATE UNIQUE INDEX "Article_public_sourceUrl_key"
ON "Article"("sourceUrl")
WHERE "ownerId" IS NULL
  AND "organizationId" IS NULL
  AND "visibility" IN ('PUBLIC', 'UNLISTED')
  AND "sourceUrl" IS NOT NULL;
