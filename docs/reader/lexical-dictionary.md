# Lexical dictionary and saved-word lookup

The lexical subsystem connects reader word selection, dictionary lookup,
normalization, explicit saved words, word mastery, and study review. It is
separate from AI-generated article vocabulary (`src/lib/vocabulary.ts`), but the
two share saved-word state in the UI.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Public barrel | `src/lib/lexical/index.ts` | Dictionary, normalization, saved words, and cloze exports. |
| Normalization | `src/lib/lexical/normalize.ts` | Contractions, morphology candidates, dictionary lookup candidates, lemma key. |
| Provider seam | `src/lib/lexical/provider.ts` | `DictionaryProvider` interface and Free Dictionary API adapter. |
| Lookup service | `src/lib/lexical/lookup.ts` | Try normalized candidates against the provider; never throw on misses/provider failure. |
| Saved words | `src/lib/lexical/saved-words.ts` | User-owned study list persistence and read models. |
| Route | `src/app/api/dictionary/route.ts` | Auth, lookup rate limit, mastery exposure, analytics metadata, frequency tier. |
| Reader UI | `src/components/WordLookup.tsx`, `src/components/reader/wordLookup/*` | Selection controller, dictionary popover, save/unsave state. |

## Normalization and lemma rules

`normalizeCandidates(raw)` is the ordered candidate list for dictionary lookup:

1. lower-case and trim,
2. normalize apostrophes,
3. strip leading/trailing non-letter characters,
4. expand common contractions,
5. strip possessives,
6. generate common inflection candidates (`ies`, `ing`, `ed`, `er`, `est`, `ly`, plural `s`).

`lemmaFor(word)` returns the first normalized candidate when present. It is the
canonical key for mastery/saved-word matching: case and possessive variants
merge, while aggressive stemming is avoided so garbage keys are not produced.

`normalize.ts` must stay pure and client-safe: no Node APIs, logger, Prisma, or
server-only imports.

## Dictionary provider contract

`DictionaryProvider.fetchEntry(word)` returns a parsed entry or `null`. Providers
must not throw for network, non-200, or not-found conditions; the lookup service
tries the next candidate and ultimately returns `{ found: false }`.

The default provider is `FreeDictionaryProvider`, backed by
`https://api.dictionaryapi.dev/api/v2/entries/en/` through the shared trusted
provider HTTP client (`src/lib/http`). It logs provider/status metadata only, not
definitions or selected text.

## Lookup route behavior

`POST /api/dictionary`:

1. validates `{ word }`,
2. applies the authenticated user's lookup rate limit,
3. runs `lookupWord(word)`,
4. records a best-effort `WordMastery` exposure,
5. records product analytics metadata `{ found }`, never the word/definition,
6. adds a frequency tier for the submitted word,
7. returns the dictionary result JSON.

The lookup endpoint is authenticated because it updates learner mastery and
emits user-scoped analytics.

## Saved words

`SavedWord` is the explicit study list and SRS queue. It is distinct from
`WordMastery`, which tracks every encountered word regardless of whether the
learner saved it.

Saved-word rules:

- `saveWord` upserts by `(userId, word)` and is idempotent,
- `unsaveWord` uses `deleteMany` and is idempotent,
- `getSavedWordSet` compares case-insensitively so reader vocabulary cards can
  show saved state without N+1 lookups,
- article-title resolution uses `readableArticleWhere(...)` so saved words from
  inaccessible articles do not become a title oracle.

SRS scheduling and flashcard grading are documented in
[`../learning/learning-and-mastery.md`](../learning/learning-and-mastery.md).

## Privacy

- Do not log selected text, definitions, examples, context sentences, or saved
  words.
- Product analytics may record lookup metadata such as `found`, not the word.
- Saved words and mastery rows are user-owned and cascade on user deletion.
- Dictionary provider responses are shown to the user and may be stored only
  when the user explicitly saves a word or when article AI vocabulary caches are
  generated through their own validator.

## Tests

Relevant tests include lexical normalization/lookup tests, `tests/vocabulary.test.ts`,
`tests/article-mastery.test.ts`, dictionary route tests, and analytics sanitizer
tests that reject word/definition-like properties.
