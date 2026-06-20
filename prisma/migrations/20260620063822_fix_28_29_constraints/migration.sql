/*
  Warnings:

  - A unique constraint covering the columns `[userId,articleId,startOffset,endOffset]` on the table `Highlight` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,name]` on the table `ReadingList` will be added. If there are existing duplicate values, this will fail.

*/

-- Dedup highlights: keep the newest row for each (userId, articleId, startOffset, endOffset) tuple.
DELETE FROM "Highlight"
WHERE "id" NOT IN (
  SELECT "id" FROM "Highlight" h1
  WHERE "createdAt" = (
    SELECT MAX(h2."createdAt")
    FROM "Highlight" h2
    WHERE h2."userId" = h1."userId"
      AND h2."articleId" = h1."articleId"
      AND h2."startOffset" = h1."startOffset"
      AND h2."endOffset" = h1."endOffset"
  )
);

-- Dedup reading lists: keep the newest default list per user; keep the newest
-- list for any other duplicated (userId, name) pairs.
DELETE FROM "ReadingList"
WHERE "id" NOT IN (
  SELECT "id" FROM "ReadingList" rl1
  WHERE "createdAt" = (
    SELECT MAX(rl2."createdAt")
    FROM "ReadingList" rl2
    WHERE rl2."userId" = rl1."userId"
      AND rl2."name" = rl1."name"
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "Highlight_userId_articleId_startOffset_endOffset_key" ON "Highlight"("userId", "articleId", "startOffset", "endOffset");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingList_userId_name_key" ON "ReadingList"("userId", "name");
