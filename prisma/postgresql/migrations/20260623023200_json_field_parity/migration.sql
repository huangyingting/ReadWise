-- Validate legacy JSON-in-string columns before converting them to PostgreSQL jsonb.
-- Empty arrays are valid; malformed JSON or unexpected shapes abort the migration.
CREATE OR REPLACE FUNCTION pg_temp._readwise_json_text_to_jsonb(
  raw_text TEXT,
  field_name TEXT,
  row_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN raw_text::jsonb;
EXCEPTION WHEN others THEN
  RAISE EXCEPTION 'JSON field migration aborted: % contains malformed JSON in row %', field_name, row_id;
END;
$$;

DO $$
DECLARE
  bad_id TEXT;
BEGIN
  SELECT p."id"
  INTO bad_id
  FROM "Profile" p
  CROSS JOIN LATERAL (
    SELECT pg_temp._readwise_json_text_to_jsonb(p."topics", 'Profile.topics', p."id") AS value
  ) parsed
  WHERE jsonb_typeof(parsed.value) <> 'array'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(parsed.value) AS topic(value)
       WHERE jsonb_typeof(topic.value) <> 'string'
     )
  LIMIT 1;

  IF bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'JSON field migration aborted: Profile.topics must be an array of strings, row %', bad_id;
  END IF;

  SELECT q."id"
  INTO bad_id
  FROM "QuizQuestion" q
  CROSS JOIN LATERAL (
    SELECT pg_temp._readwise_json_text_to_jsonb(q."options", 'QuizQuestion.options', q."id") AS value
  ) parsed
  WHERE jsonb_typeof(parsed.value) <> 'array'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(parsed.value) AS option(value)
       WHERE jsonb_typeof(option.value) <> 'string'
     )
  LIMIT 1;

  IF bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'JSON field migration aborted: QuizQuestion.options must be an array of strings, row %', bad_id;
  END IF;

  SELECT s."id"
  INTO bad_id
  FROM "ArticleSpeech" s
  CROSS JOIN LATERAL (
    SELECT pg_temp._readwise_json_text_to_jsonb(s."words", 'ArticleSpeech.words', s."id") AS value
  ) parsed
  WHERE jsonb_typeof(parsed.value) <> 'array'
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(parsed.value) AS word(value)
       WHERE CASE
         WHEN jsonb_typeof(word.value) <> 'object' THEN TRUE
         WHEN NOT (
           word.value ? 'word'
           AND word.value ? 'offset'
           AND word.value ? 'duration'
         ) THEN TRUE
         WHEN jsonb_typeof(word.value->'word') <> 'string'
           OR jsonb_typeof(word.value->'offset') <> 'number'
           OR jsonb_typeof(word.value->'duration') <> 'number' THEN TRUE
         WHEN length(btrim(word.value->>'word')) = 0 THEN TRUE
         WHEN (word.value->>'offset')::numeric < 0
           OR (word.value->>'duration')::numeric < 0 THEN TRUE
         ELSE FALSE
       END
     )
  LIMIT 1;

  IF bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'JSON field migration aborted: ArticleSpeech.words must be an array of timing objects, row %', bad_id;
  END IF;
END $$;

ALTER TABLE "Profile"
  ALTER COLUMN "topics" DROP DEFAULT,
  ALTER COLUMN "topics" TYPE JSONB USING "topics"::jsonb,
  ALTER COLUMN "topics" SET DEFAULT '[]'::jsonb;

ALTER TABLE "QuizQuestion"
  ALTER COLUMN "options" TYPE JSONB USING "options"::jsonb;

ALTER TABLE "ArticleSpeech"
  ALTER COLUMN "words" TYPE JSONB USING "words"::jsonb;
