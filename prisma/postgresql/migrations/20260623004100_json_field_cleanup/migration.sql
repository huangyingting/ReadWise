-- PostgreSQL counterpart to the JSON field cleanup migration. Validate legacy
-- JSON strings before converting TEXT columns to native jsonb.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Profile" WHERE NOT ("topics"::jsonb IS NOT NULL)) THEN
    RAISE EXCEPTION 'JSON field migration aborted: malformed Profile.topics';
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'JSON field migration aborted: malformed Profile.topics';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QuizQuestion" WHERE NOT ("options"::jsonb IS NOT NULL)) THEN
    RAISE EXCEPTION 'JSON field migration aborted: malformed QuizQuestion.options';
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'JSON field migration aborted: malformed QuizQuestion.options';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ArticleSpeech" WHERE NOT ("words"::jsonb IS NOT NULL)) THEN
    RAISE EXCEPTION 'JSON field migration aborted: malformed ArticleSpeech.words';
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'JSON field migration aborted: malformed ArticleSpeech.words';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Profile" WHERE jsonb_typeof("topics"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: Profile.topics must be an array';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Profile" p
    CROSS JOIN LATERAL jsonb_array_elements(p."topics"::jsonb) AS elem(value)
    WHERE jsonb_typeof(elem.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'JSON field migration aborted: Profile.topics entries must be strings';
  END IF;

  IF EXISTS (SELECT 1 FROM "QuizQuestion" WHERE jsonb_typeof("options"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: QuizQuestion.options must be an array';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "QuizQuestion" q
    CROSS JOIN LATERAL jsonb_array_elements(q."options"::jsonb) AS elem(value)
    WHERE jsonb_typeof(elem.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'JSON field migration aborted: QuizQuestion.options entries must be strings';
  END IF;

  IF EXISTS (SELECT 1 FROM "ArticleSpeech" WHERE jsonb_typeof("words"::jsonb) <> 'array') THEN
    RAISE EXCEPTION 'JSON field migration aborted: ArticleSpeech.words must be an array';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ArticleSpeech" s
    CROSS JOIN LATERAL jsonb_array_elements(s."words"::jsonb) AS elem(value)
    WHERE jsonb_typeof(elem.value) <> 'object'
       OR elem.value->'textOffset' IS NULL
       OR elem.value->'length' IS NULL
       OR elem.value->'start' IS NULL
       OR elem.value->'end' IS NULL
       OR jsonb_typeof(elem.value->'textOffset') <> 'number'
       OR jsonb_typeof(elem.value->'length') <> 'number'
       OR jsonb_typeof(elem.value->'start') <> 'number'
       OR jsonb_typeof(elem.value->'end') <> 'number'
       OR (elem.value->>'textOffset')::numeric < 0
       OR (elem.value->>'length')::numeric < 0
       OR (elem.value->>'start')::numeric < 0
       OR (elem.value->>'end')::numeric < (elem.value->>'start')::numeric
  ) THEN
    RAISE EXCEPTION 'JSON field migration aborted: ArticleSpeech.words entries are invalid';
  END IF;
END $$;

ALTER TABLE "Profile" ALTER COLUMN "topics" DROP DEFAULT;
ALTER TABLE "Profile" ALTER COLUMN "topics" TYPE jsonb USING "topics"::jsonb;
ALTER TABLE "Profile" ALTER COLUMN "topics" SET DEFAULT '[]'::jsonb;

ALTER TABLE "QuizQuestion" ALTER COLUMN "options" TYPE jsonb USING "options"::jsonb;
ALTER TABLE "ArticleSpeech" ALTER COLUMN "words" TYPE jsonb USING "words"::jsonb;
