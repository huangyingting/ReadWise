-- ArticleSpeech keeps narration-specific pointers and timing data only.
-- Voice metadata lives on MediaAsset; reader text is derived from Article.content.
ALTER TABLE "ArticleSpeech" DROP COLUMN "voice";
ALTER TABLE "ArticleSpeech" DROP COLUMN "plainText";
