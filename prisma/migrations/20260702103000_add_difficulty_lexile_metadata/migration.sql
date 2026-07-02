-- Add deterministic difficulty metadata.
-- lexileApprox is a Lexile-like reading-complexity estimate, not an official Lexile measure.
ALTER TABLE "Article" ADD COLUMN "lexileApprox" INTEGER;
ALTER TABLE "Article" ADD COLUMN "difficultyVersion" TEXT;