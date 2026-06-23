# Spike: Azure Batch TTS for Long-Form Articles (#374)

**Date:** 2026-06-23  
**Author:** ReadWise Backend Team  
**Status:** Design Note Only — no code changes

---

## Context

ReadWise's current TTS pipeline uses the Azure Speech SDK for **real-time
synthesis** (`SpeechSynthesizer.speakTextAsync`) with a hard cap of 5 000 characters
(`MAX_TTS_CHARS` in `src/lib/speech.ts`). Articles over that length are silently
truncated. The reference implementation (`/home/azadmin/ReadingX/lib/ai/tts.ts`)
uses the **Azure Batch Synthesis REST API** for asynchronous, long-form synthesis.
This spike evaluates whether ReadWise should adopt the batch approach.

---

## How the ReadingX Batch API Works

```
POST /texttospeech/batchsyntheses/{id}   → job created (status: NotStarted)
GET  /texttospeech/batchsyntheses/{id}   → poll (Running → Succeeded/Failed)
GET  <outputs.result>                    → download ZIP:
                                              0001.mp3  (audio)
                                              0001.word.json (word timings in ms)
DELETE /texttospeech/batchsyntheses/{id} → cleanup
```

Properties used: `wordBoundaryEnabled: true`, output format (mp3/wav), SSML input.

---

## Mapping Batch Word Timings → ReadWise `SpeechWord`

ReadingX `WordTiming`:
```ts
{ Text: string; AudioOffset: number; Duration: number }  // milliseconds
```

ReadWise `SpeechWord`:
```ts
{ textOffset: number; length: number; start: number; end: number }  // seconds
```

Mapping is straightforward:
```ts
{
  textOffset: w.textOffset,   // character offset in SSML/plain text
  length:     w.length,       // word length in characters
  start:      w.AudioOffset / 1000,              // ms → s
  end:       (w.AudioOffset + w.Duration) / 1000 // ms → s
}
```

One wrinkle: batch word-timing files use character offsets into the **SSML input**,
not the plain text. ReadWise's `htmlToPlainText` + SSML-escape transformation must
be applied consistently so offsets align with the `spokenText` stored in the DB (the
same field the client uses for word-highlight mapping). This mapping is identical to
what the SDK already produces today — the batch API just delivers the same timings
via a file instead of an event callback.

---

## Polling / Retries / ZIP Download / Cleanup

ReadingX polls with a 5-second interval and 60 attempts (5-minute timeout). For
ReadWise this maps cleanly onto the existing **Job queue** (`src/lib/jobs.ts`):

| Concern | ReadingX approach | ReadWise equivalent |
|---------|------------------|---------------------|
| Job creation | synchronous; blocks the scrape worker | `startJob(JobType.TTS_GENERATE, ...)` + `claimNextJob` |
| Polling | blocking `for` loop in the same process | `runWorker` poll loop; re-claim on each tick |
| Retry on failure | none (returns fallback) | `RETRY_POLICIES[JobType.TTS_GENERATE]` (3 attempts, 5 s base) |
| Timeout | 5 min total | `maxAttempts × backoff`; stale-lock TTL reclaim |
| ZIP download | in-process `fetch` + JSZip | `fetch` in the job handler; `jszip` already installed |
| Cleanup | `DELETE` after download | best-effort in `completeJob`; idempotent |
| Storage | converts to data-URI | upload via `getMediaStorage().put()`; store key in `ArticleSpeech` |

A `TTS_GENERATE` job payload would carry `{ articleId, voice, format }`. The job
handler would: synthesize → download ZIP → extract mp3+timings → store via
`getMediaStorage().put()` → upsert `ArticleSpeech`. An interim "pending" speech row
(no audio, `fallback: true`) could be written immediately so the reader shows
"generating…" instead of nothing.

---

## AI / Speech Budget Interaction

`src/lib/ai-budget.ts` tracks background AI spend via `AsyncLocalStorage`. The batch
TTS path is a **Speech SDK cost** (neural characters), not an OpenAI token cost, so
it lives outside the current `AiBudgetKind` ledger. However:

- `src/lib/config.ts` already exposes `AZURE_SPEECH_KEY/REGION` for optional
  speech config; batch synthesis uses the same key and region.
- A per-article character-count estimate (available from `spokenText.length`) could
  be written to `AiInvocation` with a "speech" feature label for cost tracking
  (`src/lib/ai-ledger.ts`). The batch API's
  `properties.billingDetails.neuralCharacters` provides the exact count after
  completion.
- The existing `checkRateLimit(userId, "ai")` in the speech POST route is the
  reader-facing guard; background batch jobs would use `checkAiBudget("background")`
  or a new `"speech"` feature key.

---

## Article Length Threshold

The batch synthesis API has a documented per-request limit of **~10 000 characters**
per SSML input (some sources cite 50 000 for batch). ReadingX does not apply a cap.

Rough timing comparison (Azure eastus, neural voice):

| Text length | Real-time SDK | Batch API (min latency) |
|------------|---------------|------------------------|
| < 1 000 chars | ~2-4 s | ~30-60 s (job creation + first poll) |
| 1 000–5 000 chars | ~5-15 s | ~30-90 s |
| 5 000–20 000 chars | times out / truncated | ~60-180 s |
| > 20 000 chars | not supported | supported |

**Recommendation threshold:** batch synthesis is only worthwhile for articles longer
than **~8 000 characters** (≈ 1 600 words, ≈ 8-minute reads). Below that, the
real-time SDK is faster and simpler. ReadWise's current `MAX_TTS_CHARS = 5 000` is
already below the real-time SDK's practical ceiling; a hybrid strategy would:

1. Continue using the real-time SDK for articles ≤ 8 000 chars (covers ~90% of
   articles).
2. Dispatch a `TTS_GENERATE` batch job for longer articles, serving a "loading"
   state until the job completes.

---

## Interaction with Storage Streaming (#372)

The new `GET /api/reader/[id]/speech/audio` endpoint introduced in #372 is the
correct delivery path for batch-synthesized audio. Batch jobs produce larger files
(potentially several MB) that should **not** be base64-encoded in the DB. The flow:

```
Batch job completes
  → download MP3 bytes from Azure result ZIP
  → storage.put({ data, mimeType, keyHint: "speech/<articleId>" })
  → ArticleSpeech.storageKey = put.storageKey
  → AudioBase64 = null
  → Client: <audio src="/api/reader/<id>/speech/audio"> (streams from storage)
```

This is exactly what `getOrCreateArticleSpeech` already does for real-time synthesis
when `getMediaStorage()` is non-null — the batch path reuses the same write path.

---

## Recommendation: **Defer**

**Do not implement batch TTS now.** Rationale:

1. **Scope creep** — batch synthesis requires a persistent job queue integration, a
   `TTS_GENERATE` handler, client-side "loading" UX, and new Azure REST API code.
   That is a meaningful feature with its own test surface.

2. **Low ROI today** — ReadWise's article import pipeline already caps content at
   practical lengths. The scraper's word-count minimum (50 words) and `MAX_TTS_CHARS`
   cover the current article corpus. The 5 000-char limit can be raised to ~8 000
   (the real-time SDK handles it) without any batch infrastructure.

3. **Real-time SDK still works** — the SDK timeout is configurable (`SPEECH_TIMEOUT_MS`).
   Raising `MAX_TTS_CHARS` to 8 000 and `SPEECH_TIMEOUT_MS` to 60 s handles most
   real-world articles with zero added complexity.

4. **Prerequisites** — batch TTS over `TTS_GENERATE` jobs requires the Job queue
   worker path to be wired for speech. That is its own buildout.

**When to revisit:** if the editorial team begins importing long-form content (books,
long-read journalism > 2 000 words) and TTS truncation becomes a user complaint,
implement the `TTS_GENERATE` job handler using the design above. The storage
streaming endpoint (#372) and object-storage backend (#371) are already in place —
they are the hardest parts of the integration.

---

## Appendix: Key ReadingX Reference Files

- `/home/azadmin/ReadingX/lib/ai/tts.ts` — full batch synthesis implementation
  (create → poll → download ZIP → extract mp3+word timings → cleanup)
- Word timing format: `{ Text, AudioOffset (ms), Duration (ms) }` in
  `0001.word.json` inside the result ZIP

ReadWise counterparts:
- `src/lib/speech.ts` — `SpeechWord`, `getOrCreateArticleSpeech`, `synthesize`
- `src/lib/jobs.ts` — `JobType.TTS_GENERATE`, `RETRY_POLICIES`
- `src/lib/worker.ts` — `runWorker`, `sleep`, `processWithRetry`
- `src/lib/ai-budget.ts` — `checkAiBudget`, `assertAiQuota`
- `src/lib/storage.ts` — `getMediaStorage`, `AzureBlobMediaStorage`
