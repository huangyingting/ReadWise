-- Convert legacy JSON-in-string columns to PostgreSQL JSONB.
-- Malformed JSON aborts through the explicit ::jsonb casts; shape checks keep
-- parity with the SQLite cleanup migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Profile" WHERE jsonb_typeof("topics"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: Profile.topics must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Profile" AS p
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p."topics"::jsonb) AS elem
      WHERE jsonb_typeof(elem) <> 'string'
    )
  ) THEN
    RAISE EXCEPTION 'JSON field migration aborted: Profile.topics entries must be strings';
  END IF;

  IF EXISTS (SELECT 1 FROM "QuizQuestion" WHERE jsonb_typeof("options"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: QuizQuestion.options must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "QuizQuestion" AS q
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(q."options"::jsonb) AS elem
      WHERE jsonb_typeof(elem) <> 'string'
    )
  ) THEN
    RAISE EXCEPTION 'JSON field migration aborted: QuizQuestion.options entries must be strings';
  END IF;

  IF EXISTS (SELECT 1 FROM "ArticleSpeech" WHERE jsonb_typeof("words"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: ArticleSpeech.words must be an array';
  END IF;
END $$;

ALTER TABLE "Profile" ALTER COLUMN "topics" DROP DEFAULT;
ALTER TABLE "Profile" ALTER COLUMN "topics" TYPE JSONB USING "topics"::jsonb;
ALTER TABLE "Profile" ALTER COLUMN "topics" SET DEFAULT '[]'::jsonb;

ALTER TABLE "QuizQuestion" ALTER COLUMN "options" TYPE JSONB USING "options"::jsonb;
ALTER TABLE "ArticleSpeech" ALTER COLUMN "words" TYPE JSONB USING "words"::jsonb;
