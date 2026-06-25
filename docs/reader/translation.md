# Translation service

ReadWise supports full-article translations and sentence/selection translations.
Both are cache-first, access-checked, prompt-versioned AI features that degrade
gracefully when AI is unavailable.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Full-article translation | `src/lib/translation.ts` | Article-level cache, chunked generation, language labels. |
| Sentence translation | `src/lib/sentence-translation.ts` | Selection-level cache by normalized text hash. |
| Supported languages | `src/lib/supported-languages.ts` | Language codes and display labels. |
| AI lifecycle | `src/lib/ai-cache.ts` | Cache-first generation and no-cache fallback contract. |
| Prompts | `src/lib/ai/prompts/translation.ts`, `src/lib/ai/prompts/sentence-translation.ts` | Prompt templates and versions. |
| Routes | `src/app/api/reader/[id]/translate/route.ts`, `src/app/api/reader/[id]/translate-sentence/route.ts` | Auth, validation, request context, responses. |

## Full-article translations

`getOrCreateTranslation(articleId, lang, context?)` uses the `Translation` table
keyed by `(articleId, targetLang)`.

On a cache miss:

1. article access is checked through the article-library policy,
2. stored HTML is converted to canonical reader text,
3. text is chunked with `chunkForFeature(..., "translation")`,
4. each chunk is translated with the active prompt,
5. all chunks must succeed,
6. the joined result is persisted with the current AI model name.

If any chunk fails or AI is unconfigured, the function returns a language-aware
fallback message and writes nothing to the cache.

## Sentence translations

`translateSentence(articleId, text, lang, context?)` is for selected text or a
short phrase.

Rules:

- text is normalized by trimming and collapsing whitespace,
- maximum source length is `MAX_SENTENCE_CHARS = 1000`,
- unsupported languages return a fallback result,
- cache key is `(articleId, SHA-256(normalized text), targetLang)`,
- source text is stored normalized for inspection/debugging,
- failed/unconfigured AI calls are not cached.

Article existence and access are checked before the selection AI lifecycle runs.

## Prompt and cache versioning

Both features record active prompt versions through the AI lifecycle and ledger.
Full-article cache rows are partitioned by table key, while content/prompt
versioning for generated features is documented in [`../ai/context-management.md`](../ai/context-management.md)
and [`../ai/prompts.md`](../ai/prompts.md).

When changing translation prompt wording, bump the prompt version and plan a
targeted rebuild/backfill for stale translations.

## Privacy

Do not log source text, selected text, translated text, prompts, or article
content. Analytics events may record safe metadata such as target language only.
The AI ledger stores feature/model/status/token metadata, not text.

## Operational behavior

- Missing AI config returns a fallback; it is not a readiness failure.
- Full-article translation can use multiple provider calls for long texts.
- Sentence translations are bounded to avoid using the endpoint as a long-text
  translation proxy.
- User deletion cascades translations only through article deletion; public
  article translations are article-owned, not user-owned.

## Tests

Relevant tests include `tests/translation.test.ts`,
`tests/sentence-translation.test.ts`, `tests/ai-chunking.test.ts`,
`tests/prompts.test.ts`, and reader translation route tests.
