-- Validate legacy JSON-in-string columns before converting them to Prisma Json.
-- Empty arrays are valid; malformed JSON or unexpected shapes abort the migration.
CREATE TABLE "_JsonFieldMigrationInvalid" ("message" TEXT NOT NULL);
CREATE TRIGGER "_JsonFieldMigrationInvalid_abort"
BEFORE INSERT ON "_JsonFieldMigrationInvalid"
BEGIN
  SELECT RAISE(ABORT, 'JSON field migration aborted: malformed or invalid existing JSON string');
END;

INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'Profile.topics:' || "id" FROM "Profile" WHERE NOT json_valid("topics");
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'Profile.topics:' || "id" FROM "Profile" WHERE json_valid("topics") AND json_type("topics") <> 'array';
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'Profile.topics:' || p."id"
FROM (SELECT "id", "topics" FROM "Profile" WHERE json_valid("topics")) AS p
WHERE EXISTS (SELECT 1 FROM json_each(p."topics") WHERE json_each."type" <> 'text');

INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'QuizQuestion.options:' || "id" FROM "QuizQuestion" WHERE NOT json_valid("options");
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'QuizQuestion.options:' || "id" FROM "QuizQuestion" WHERE json_valid("options") AND json_type("options") <> 'array';
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'QuizQuestion.options:' || q."id"
FROM (SELECT "id", "options" FROM "QuizQuestion" WHERE json_valid("options")) AS q
WHERE EXISTS (SELECT 1 FROM json_each(q."options") WHERE json_each."type" <> 'text');

INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'ArticleSpeech.words:' || "id" FROM "ArticleSpeech" WHERE NOT json_valid("words");
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'ArticleSpeech.words:' || "id" FROM "ArticleSpeech" WHERE json_valid("words") AND json_type("words") <> 'array';
INSERT INTO "_JsonFieldMigrationInvalid" ("message")
SELECT 'ArticleSpeech.words:' || s."id"
FROM (SELECT "id", "words" FROM "ArticleSpeech" WHERE json_valid("words")) AS s
WHERE EXISTS (
  SELECT 1
  FROM json_each(s."words") AS w
  WHERE w."type" <> 'object'
     OR json_type(w."value", '$.textOffset') NOT IN ('integer', 'real')
     OR json_type(w."value", '$.length') NOT IN ('integer', 'real')
     OR json_type(w."value", '$.start') NOT IN ('integer', 'real')
     OR json_type(w."value", '$.end') NOT IN ('integer', 'real')
     OR json_extract(w."value", '$.textOffset') < 0
     OR json_extract(w."value", '$.length') < 0
     OR json_extract(w."value", '$.start') < 0
     OR json_extract(w."value", '$.end') < json_extract(w."value", '$.start')
);

DROP TRIGGER "_JsonFieldMigrationInvalid_abort";
DROP TABLE "_JsonFieldMigrationInvalid";

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ageRange" TEXT,
    "gender" TEXT,
    "englishLevel" TEXT NOT NULL,
    "topics" JSONB NOT NULL DEFAULT [],
    "completedAt" DATETIME,
    "dailyGoal" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT,
    "streakShields" INTEGER NOT NULL DEFAULT 0,
    "levelUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Profile" ("ageRange", "completedAt", "createdAt", "dailyGoal", "englishLevel", "gender", "id", "levelUpdatedAt", "streakShields", "timezone", "topics", "updatedAt", "userId")
SELECT "ageRange", "completedAt", "createdAt", "dailyGoal", "englishLevel", "gender", "id", "levelUpdatedAt", "streakShields", "timezone", jsonb("topics"), "updatedAt", "userId" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

CREATE TABLE "new_QuizQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuizQuestion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QuizQuestion" ("articleId", "correctIndex", "createdAt", "id", "options", "question", "updatedAt")
SELECT "articleId", "correctIndex", "createdAt", "id", jsonb("options"), "question", "updatedAt" FROM "QuizQuestion";
DROP TABLE "QuizQuestion";
ALTER TABLE "new_QuizQuestion" RENAME TO "QuizQuestion";
CREATE INDEX "QuizQuestion_articleId_idx" ON "QuizQuestion"("articleId");
CREATE UNIQUE INDEX "QuizQuestion_articleId_question_key" ON "QuizQuestion"("articleId", "question");

CREATE TABLE "new_ArticleSpeech" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "audioBase64" TEXT NOT NULL,
    "spokenText" TEXT NOT NULL,
    "words" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleSpeech_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ArticleSpeech" ("articleId", "audioBase64", "createdAt", "format", "id", "mimeType", "spokenText", "updatedAt", "voice", "words")
SELECT "articleId", "audioBase64", "createdAt", "format", "id", "mimeType", "spokenText", "updatedAt", "voice", jsonb("words") FROM "ArticleSpeech";
DROP TABLE "ArticleSpeech";
ALTER TABLE "new_ArticleSpeech" RENAME TO "ArticleSpeech";
CREATE UNIQUE INDEX "ArticleSpeech_articleId_key" ON "ArticleSpeech"("articleId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
