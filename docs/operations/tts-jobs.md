---
title: "TTS job scheduling, retry, and rebuild"
category: "Operations"
architecture: "Documents Operations-owned TTS_GENERATE job scheduling and its boundary with Speech/Media."
design: "Captures current dedupe, retry, rebuild, worker, processing-step, and operator behavior for generated narration."
plan: "Update when TTS job payloads, worker handlers, speech generation, media storage, rebuild flows, or admin job routes change."
updated: "2026-07-01"
rename: "none"
---

# TTS job scheduling, retry, and rebuild

This document covers Operations ownership of `TTS_GENERATE` background jobs:
scheduling, deduplication, retry policy, rebuild flow, and processing step
status. Speech synthesis logic itself is in
[`../speech/generation.md`](../speech/generation.md); media asset lifecycle is
in [`../media/assets.md`](../media/assets.md).

## Ownership boundary

**Operations owns** `TTS_GENERATE` job creation, enqueueing, claim/lock/retry
lifecycle, dead-lettering, processing step timeline (`ArticleProcessingStep`),
and the worker handler that dispatches to `processArticle`. Operations does
**not** own speech synthesis (owned by Speech), storage key selection (owned by
Media), or reader playback (owned by Reader).

## Job type: TTS_GENERATE

| Field | Value |
| ----- | ----- |
| `type` | `TTS_GENERATE` |
| `payload.articleId` | Target article. |
| `payload.tts` | Always `true` — gates the speech step in `processArticle`. |
| `dedupeKey` | `tts-generate:<articleId>` — one active job per article. |
| Max attempts | 3 |
| Base backoff | 5 s |
| Max backoff | 10 min |

`enqueueTtsGenerate(articleId, opts)` in `src/lib/jobs/enqueue.ts` creates or
returns the existing active `TTS_GENERATE` job for the article. If an active
job already exists with the same `dedupeKey`, the existing row is returned
without creating a duplicate.

## Worker dispatch

`TTS_GENERATE` jobs are handled by the same `articleHandler` as
`ARTICLE_INGEST`, `ARTICLE_PROCESS`, and `AI_REBUILD`
(`src/lib/worker/registry.ts:createDefaultRegistry`). The handler calls
`processArticle(articleId, { tts: true })`.

`processArticle` (`src/lib/processing/processor.ts`) gates the speech step on
`opts.tts === true`. When the flag is absent (e.g. an `ARTICLE_PROCESS` job
without `tts: true`), the speech step is skipped. This means:

- `TTS_GENERATE` is the correct job type when narration is the explicit goal.
- `ARTICLE_PROCESS` with `payload.tts = true` (e.g. from a backfill) also
  triggers narration generation via the same gate.

## Processing step: speech

The speech step is tracked in `ArticleProcessingStep` under `step = "speech"`
(mapped from the internal `"tts"` feature key by `processArticle`). Step states:

| Status | Meaning |
| ------ | ------- |
| `pending` | Step row not yet started. |
| `running` | Step is in progress (lock held). |
| `generated` | Azure Speech returned audio and word timings; persisted. |
| `skipped` | Article already had a cached `ArticleSpeech` row (cache hit). |
| `fallback` | Azure Speech unconfigured or synthesis failed; no audio stored. |
| `failed` | Unhandled error in the speech step. |

A `fallback` result means the step completed without error but no narration was
stored (speech config absent or article text empty). The job is marked
`COMPLETED` in this state — it is not retried, because retrying would produce
the same result until configuration is added.

A `failed` result causes the job to retry up to the configured `maxAttempts`
(3). After exhausting attempts the job moves to `DEAD_LETTER`.

## Rebuild flow

Admin AI rebuild (`adminRebuildArticleAI`, `src/lib/article-library/admin.ts`):

1. Deletes the `ArticleSpeech` row for the article.
2. Deletes `MediaAsset` rows for the article (`kind = "speech"`).
3. Deletes `ArticleProcessingStep` rows for all steps except `"difficulty"`.

After a rebuild:

- The next reader request triggers `getOrCreateArticleSpeech` → cache miss →
  live synthesis (if Azure Speech is configured).
- Alternatively, an admin can enqueue a `TTS_GENERATE` job via
  `enqueueTtsGenerate(articleId)` or via the admin jobs UI to pre-warm
  narration in the background.

Note: storage objects are **not** deleted by the rebuild. The bytes remain in
object storage as orphans until a cleanup pass removes them. See
[`../media/assets.md`](../media/assets.md) for orphan handling.

## Retry policy

From `src/lib/jobs/retry-policy.ts`:

| Max attempts | Base backoff | Max backoff |
| ---: | ---: | ---: |
| 3 | 5 s | 10 min |

Backoff is exponential with jitter:

$$
delay = \min(\text{maxBackoff},\ \text{base} \times 2^{\text{attempt}-1}) + \text{jitter}
$$

where jitter is bounded by `min(base, exp)`.

Provider failures (`JobError({ kind: "provider" })`) are retryable. Validation
and missing-entity failures (`kind: "validation"` | `"missing"`) are permanent
and move immediately to `DEAD_LETTER` without consuming retry attempts.

## Backfill

`processArticle` with `tts: true` is used by the backfill runner
(`src/lib/processing/backfill.ts`). The backfill sets `payload.tts = true` to
include the speech step in bulk re-processing runs.

## Admin surface

The admin jobs dashboard (`/admin/jobs`) shows `TTS_GENERATE` jobs with their
`status`, `attempts`, `lastError`, and `lockedBy`. Operators can retry or
dead-letter jobs from this UI.

Article detail pages (`/admin/articles/[id]`) show `ArticleProcessingStep`
status per step, including the `speech` step, so operators can see whether
narration was generated, fell back, or failed for a specific article.

## Related docs

- [`../speech/generation.md`](../speech/generation.md) — TTS provider seam,
  `ArticleSpeech` generation semantics, cache invalidation.
- [`../media/assets.md`](../media/assets.md) — `MediaAsset` lifecycle, storage
  keys, deletion, orphan handling after rebuild.
- [`../reader/playback.md`](../reader/playback.md) — reader playback UX; how
  narration is consumed by the Reader.
- [`admin-operations.md`](./admin-operations.md) — full job queue model, claim/lock,
  retry mechanics, and CLI usage.
