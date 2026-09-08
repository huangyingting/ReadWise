UPDATE "TodayComprehensionFeedback"
SET "remediationViewed" = 1
WHERE "remediationViewed" = 0
  AND EXISTS (
    SELECT 1
    FROM "TodayComprehensionFeedback" AS "duplicate"
    WHERE "duplicate"."userId" = "TodayComprehensionFeedback"."userId"
      AND "duplicate"."todaySessionId" = "TodayComprehensionFeedback"."todaySessionId"
      AND "duplicate"."remediationViewed" = 1
  );

DELETE FROM "TodayComprehensionFeedback"
WHERE "id" IN (
  SELECT "older"."id"
  FROM "TodayComprehensionFeedback" AS "older"
  JOIN "TodayComprehensionFeedback" AS "newer"
    ON "newer"."userId" = "older"."userId"
   AND "newer"."todaySessionId" = "older"."todaySessionId"
   AND (
     "newer"."updatedAt" > "older"."updatedAt"
     OR (
       "newer"."updatedAt" = "older"."updatedAt"
       AND "newer"."id" > "older"."id"
     )
   )
);

CREATE UNIQUE INDEX "TodayComprehensionFeedback_userId_todaySessionId_key"
ON "TodayComprehensionFeedback"("userId", "todaySessionId");
