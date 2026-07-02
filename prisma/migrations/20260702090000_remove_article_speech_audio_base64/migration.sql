-- Remove legacy database-backed speech audio storage.
-- Speech audio is now persisted only in local or Azure media storage.
ALTER TABLE "ArticleSpeech" DROP COLUMN "audioBase64";
