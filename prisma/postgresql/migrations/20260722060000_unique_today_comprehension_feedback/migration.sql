UPDATE "TodayComprehensionFeedback" AS "feedback"
SET "remediationViewed" = true
WHERE "feedback"."remediationViewed" = false
  AND EXISTS (
    SELECT 1
    FROM "TodayComprehensionFeedback" AS "duplicate"
    WHERE "duplicate"."userId" = "feedback"."userId"
      AND "duplicate"."todaySessionId" = "feedback"."todaySessionId"
      AND "duplicate"."remediationViewed" = true
  );

DELETE FROM "TodayComprehensionFeedback" AS "older"
USING "TodayComprehensionFeedback" AS "newer"
WHERE "newer"."userId" = "older"."userId"
  AND "newer"."todaySessionId" = "older"."todaySessionId"
  AND (
    "newer"."updatedAt" > "older"."updatedAt"
    OR (
      "newer"."updatedAt" = "older"."updatedAt"
      AND "newer"."id" > "older"."id"
    )
  );

CREATE UNIQUE INDEX "TodayComprehensionFeedback_userId_todaySessionId_key"
ON "TodayComprehensionFeedback"("userId", "todaySessionId");
