# AI context management & long-text chunking

This document describes the long-text / context-management work added in Epic
**RW-E004 / RW-025**, and how it builds on the provider abstraction from
**RW-023**. For output validation and moderation see
[`safety.md`](./safety.md).

Long articles can exceed a model's context window or degrade output quality when
sent as one giant prompt. The goal here is to keep every AI prompt **bounded**
and to pick the right **context strategy per feature**, with no tokenizer
dependency and no Prisma schema changes.

---

## 1. Token-aware utilities (`src/lib/ai/chunking.ts`)

| Helper | Purpose |
| --- | --- |
| `estimateTokens(text)` | Cheap `chars ≈ 4` heuristic. **Monotonic** and a deliberate over-estimate for safety margin (`estimateTokens(a) ≤ estimateTokens(a + b)`). No tokenizer dependency. |
| `tokensToChars(tokens)` | Inverse scale of the estimator. |
| `clampToTokens(text, maxTokens)` | Truncates to a whitespace boundary within the budget. |
| `chunkText(text, maxTokens, overlap)` | Splits into ordered chunks that never exceed `maxTokens`, overlapping consecutive chunks to preserve boundary context. Splits on sentences → words → hard char-split. |
| `boundedSampleForFeature(text, feature)` | Representative, token-bounded sample for features that don't need the full text. |
| `chunkForFeature(text, feature)` | Full-coverage chunking for features that must process the whole article. |
| `resolveInputBudget(feature, maxContextTokens?)` | The effective input-token budget, clamped so the prompt + completion still fit the model window. |

`resolveInputBudget` reserves ~25% of the model context window for the system
prompt + completion, then clamps to the feature's configured `maxInputTokens`.
The model window comes from the active provider's capability metadata
(`aiMaxContextTokens()` / `AiProviderCapabilities.maxContextTokens`, RW-023), so
swapping providers automatically re-sizes the budgets.

---

## 2. Per-feature context strategy

`FEATURE_CONTEXT` in `src/lib/ai/chunking.ts` declares each feature's strategy.
Values mirror the previous character caps (chars ≈ 4·tokens) so single-call
features keep their behavior, while translation gains full coverage:

| Feature | Strategy | Input budget | Why |
| --- | --- | --- | --- |
| `translation` | `chunk-full` (overlap 120 tok) | 1500 tok/chunk | Must translate the **entire** article — chunked across multiple calls, joined back together. |
| `vocabulary` | `sample` | 2000 tok | A bounded leading sample yields plenty of study words. |
| `quiz` | `sample` | 2000 tok | Questions are drawn from a bounded representative sample. |
| `tags` | `sample` | 1500 tok | Topic tags only need a representative sample. |
| `difficulty` | `sample` | 1500 tok | CEFR assessment uses a representative sample (heuristic fallback uses the same sample). |
| `tutor` | `sample` | 1750 tok | The article is context for an interactive chat; a bounded slice keeps each turn cheap. |

**Translation full-coverage guarantee:** `getOrCreateTranslation`
(`src/lib/translation.ts`) calls `chunkForFeature(text, "translation")`,
translates each chunk via the provider, and joins the parts. If **any** chunk
fails, the whole translation degrades to a graceful, **uncached** placeholder so
a partial translation is never stored. Overlap between chunks keeps context from
being lost at boundaries.

**Sampled features** call `boundedSampleForFeature(text, feature)` when building
their prompt, so a 20-minute longread costs the same as a short article.

---

## 3. Content & prompt versioning (RW-025, no schema changes)

To avoid repeatedly sending large article content for small interactions and to
avoid serving stale AI output after an article is edited, caches should key on
**which text** and **which prompt** produced a result. Because this PR makes **no
Prisma schema changes**, these dimensions are derived in-key / in-ledger rather
than added as columns:

| Helper | Purpose |
| --- | --- |
| `hashContent(text)` | Stable 16-char content hash. Identical source text shares a hash; an edit changes it. |
| `promptVersionFor(feature)` | The prompt revision label from the prompt registry, bumped when a feature's prompt changes. |
| `aiContentCacheKey(feature, scope, content)` | `"<promptVersion>:<scope>:<contentHash>"` — a deterministic key that is stable for repeated interactions over unchanged content and changes on an edit or a prompt bump. |

How each cache currently handles versioning:

- **Per-article caches** (translation, vocabulary, quiz, tags, difficulty,
  speech) are keyed by `articleId` in the database. The **prompt version** is
  recorded on every provider call via the AI invocation ledger (the
  `promptVersion` option threaded through `src/lib/ai-cache.ts`), so generations
  from different prompt revisions are distinguishable for analytics and audits.
  When an article's content changes, the admin **rebuild** action
  (`rebuildArticleAi`) clears the derived AI rows so they regenerate from the new
  content on the next reader visit — this is the content-version invalidation
  path without a schema change.
- **Free-text / phrase caches** that key on the *input* text already fold the
  content into their key. `translateSentence` (`src/lib/sentence-translation.ts`)
  keys on a SHA-256 hash of the selected text, so repeated lookups of the same
  phrase reuse the cache and only changed text triggers a new call.

`aiContentCacheKey` / `hashContent` / `promptVersionFor` are provided as the
canonical building blocks for any **new** cache that needs an explicit
content/prompt dimension in its key.

---

## 4. Why repeated small interactions are cheap

1. **Cache-first.** Every per-article helper reads its cache before any AI call;
   a hit returns immediately with no model call (`tests/translation.test.ts`
   "repeated requests reuse the cache").
2. **Bounded prompts.** Sampled features clamp article context to a fixed token
   budget, so cost is independent of article length.
3. **Stable keys.** Content + prompt versioning means unchanged content keeps
   reusing the same result; only a genuine edit or prompt bump invalidates it.

---

## 5. Testing

`tests/ai-chunking.test.ts` covers:

- the estimator is monotonic and over-estimates;
- `chunkText` never exceeds the cap, covers all sentences, and overlap repeats
  boundary context;
- a single oversized token is hard-split within the cap;
- translation chunking covers the full text across multiple chunks;
- sampled features stay within their budget;
- `hashContent` is stable for identical text and changes on edit;
- repeated interactions over unchanged content reuse the cache key.

`tests/translation.test.ts` additionally verifies multi-chunk translation
coverage, that a single failed chunk degrades to an uncached fallback, and that a
second request is served from cache with no new AI call.
