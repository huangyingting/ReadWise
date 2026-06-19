-- CreateTable
CREATE TABLE "DailyActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "articlesRead" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ageRange" TEXT,
    "gender" TEXT,
    "englishLevel" TEXT NOT NULL,
    "topics" TEXT NOT NULL DEFAULT '[]',
    "completedAt" DATETIME,
    "dailyGoal" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("ageRange", "completedAt", "createdAt", "englishLevel", "gender", "id", "topics", "updatedAt", "userId") SELECT "ageRange", "completedAt", "createdAt", "englishLevel", "gender", "id", "topics", "updatedAt", "userId" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
CREATE TABLE "new_SavedWord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "explanation" TEXT,
    "example" TEXT,
    "articleId" TEXT,
    "dueAt" DATETIME,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavedWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SavedWord" ("articleId", "createdAt", "example", "explanation", "id", "updatedAt", "userId", "word") SELECT "articleId", "createdAt", "example", "explanation", "id", "updatedAt", "userId", "word" FROM "SavedWord";
DROP TABLE "SavedWord";
ALTER TABLE "new_SavedWord" RENAME TO "SavedWord";
CREATE INDEX "SavedWord_userId_idx" ON "SavedWord"("userId");
CREATE UNIQUE INDEX "SavedWord_userId_word_key" ON "SavedWord"("userId", "word");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DailyActivity_userId_idx" ON "DailyActivity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActivity_userId_date_key" ON "DailyActivity"("userId", "date");
