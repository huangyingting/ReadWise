---
type: "reference"
status: "current"
last_updated: "2026-07-18"
description: "Documents real-time and Batch narration, timing enrichment, voice/format fallback, and ArticleSpeech generation. Captures current Azure Speech synthesis flow, cache/storage behavior, timing migration, readiness, and graceful fallback rules."
---

# Speech generation

This document covers the Speech subsystem's ownership: the TTS provider seam,
request building, voice and format fallback, word-boundary collection, and
`ArticleSpeech` generation semantics.

For object-storage and `MediaAsset` lifecycle, see
[`../media/assets.md`](../media/assets.md) and
[`../media/storage.md`](../media/storage.md).
For reader playback UX that consumes the generated audio, see
[`../reader/playback.md`](../reader/playback.md).
For background TTS job scheduling, see
[`../operations/tts-jobs.md`](../operations/tts-jobs.md).

## Ownership boundary

**Speech subsystem owns** the TTS provider seam, real-time and Batch request
building, voice and output-format selection and fallback, word-boundary
collection and timing enrichment, Azure SDK and Batch REST isolation,
`ArticleSpeech` cache creation and invalidation, and the `saveSpeechResult` /
`resolveStoredSpeechMedia` repository functions.

**Speech does not own** storage backend selection or migration (owned by Media),
reader playback UX (owned by Reader), or job retry scheduling (owned by
Operations).

## Code map

| File | Purpose |
| ---- | ------- |
| `src/lib/speech/index.ts` | Public entry point. Exports `getOrCreateArticleSpeech`, timing/practice utilities, and `SpeechResult` type. |
| `src/lib/speech/provider-azure.ts` | Azure SDK isolation — the only module that imports `microsoft-cognitiveservices-speech-sdk`. |
| `src/lib/speech/azure-batch-synthesis.ts` | Full Azure Batch workflow behind `runAzureBatchSynthesis`: selection, SSML, job planning, REST calls, result parsing, timing enrichment, and persistence. |
| `src/lib/speech/repository.ts` | ArticleSpeech DB reads/writes, corrupt-cache recovery, `MediaAsset` upsert, storage interaction. |
| `src/lib/speech/text-basis.ts` | Canonical Narration text basis preparation and cache-reconstruction policy for real-time and Batch adapters. |
| `src/lib/speech/timing.ts` | Word-timing types and utilities (`SpeechWord`, `timingStartSeconds`, `timingEndSeconds`). |
| `src/lib/speech/timing-alignment.ts` | Token alignment for word-highlight mapping. |
| `src/lib/speech/timing-enrichment.ts` | Canonical policy for adding reader-text spans to provider word timings. |
| `src/lib/speech/timing-migration.ts` | Stored timing format migration and span repair; delegates span policy to timing enrichment. |
| `src/lib/speech/practice.ts` | Sentence segmentation for practice tools. |
| `src/lib/runtime-config/speech.ts` | Azure Speech env parsing: key, region, voice, format, timeout. |
| `scripts/batch-synthesis.ts` | Thin CLI adapter for argument parsing, validation, loop control, and process lifecycle. |

## TTS provider seam

`provider-azure.ts` is the **only** module that imports
`microsoft-cognitiveservices-speech-sdk`. Confining the Azure SDK here:

- Prevents accidental browser-bundle inclusion (the SDK is server-only).
- Gives synthesis a single well-defined seam for testing and future provider
  substitution.

The public interface is:

```ts
synthesize(text: string, config: SpeechConfig, articleId: string): Promise<SynthesisOutput | null>
resolveMimeType(format: string): string
```

`synthesize` resolves `null` on any provider failure so callers can degrade
gracefully without throwing.

To add an alternative TTS provider, implement a parallel `synthesize` function
with the same signature and switch between providers in `speech/index.ts`. No
caller outside `speech/` needs to change.

## Request building and text basis

`prepareNarrationText` in `src/lib/speech/text-basis.ts` derives the Narration
text basis from canonical Reader text. The real-time adapter uses a 5,000
character prefix. The Batch adapter uses full paragraph blocks by default or a
paragraph-aware character limit when `--max-chars` is supplied. SSML, pauses,
styles, and voice rotation remain Batch-specific request concerns.

The real-time bound limits:

- Azure Speech latency and per-request cost.
- Audio file size stored in the database or object storage.
- Word-boundary array size in `ArticleSpeech.words`.

V2 timing metadata stores only the basis descriptor (`full`, `character-limit`,
or `paragraph-limit` plus the numeric limit). Cache hits replay that policy
against current `Article.content`, so capped Batch narration returns the same
Reader text scope used during generation. The Reader text itself is not
duplicated in `ArticleSpeech`. Legacy rows without a descriptor retain the old
provider-based fallback: Azure Batch is treated as full text and other providers
as the 5,000-character real-time prefix.

## Voice and format selection

Voice and output format are read from environment variables via
`src/lib/runtime-config/speech.ts`:

| Variable                    | Default                                    |
| --------------------------- | ------------------------------------------ |
| `AZURE_SPEECH_ENDPOINT`     | REST batch script only; derived from region when unset |
| `AZURE_SPEECH_VOICE`        | `en-US-AndrewMultilingualNeural`           |
| `AZURE_SPEECH_OUTPUT_FORMAT`| `audio-24khz-96kbitrate-mono-mp3`          |
| `SPEECH_TIMEOUT_MS`         | `30000`                                    |

**Voice fallback:** when `AZURE_SPEECH_VOICE` is unset, `DEFAULT_SPEECH_VOICE`
is used. The generated voice is recorded in `MediaAsset.voice`; cached reader
responses obtain voice metadata from that asset.

**Format fallback:** when `AZURE_SPEECH_OUTPUT_FORMAT` is unset or unrecognised
by `resolveOutputFormat`, the function falls back to
`Audio24Khz96KBitRateMonoMp3` / `audio/mpeg`. Supported format strings are
defined in the `map` inside `provider-azure.ts`.

**No multi-voice cache:** an article has exactly one active `ArticleSpeech` row.
Changing voice or format does not retain the previous narration; the next
synthesis request overwrites it.

## Azure Batch Synthesis CLI

Use `npm run speech:batch` for backend/offline narration jobs that should cover
full article text instead of the live-listening `MAX_TTS_CHARS = 5000` cap.
`scripts/batch-synthesis.ts` parses and validates CLI arguments and controls
single-pass or loop execution. It delegates each pass to
`runAzureBatchSynthesis` in `src/lib/speech/azure-batch-synthesis.ts`, which owns
article selection, DOM-order reader-block extraction, SSML and job planning,
Azure submission and polling, result download and parsing, and persistence
through `saveSpeechResult`.

Azure Batch Synthesis `[nnnn].word.json` entries contain `Text`, `AudioOffset`,
and `Duration` already in **milliseconds** (unlike the real-time Speech SDK word-
boundary events, which use 100-nanosecond ticks and require dividing by 10,000).
The parser stores these values directly as `SpeechWord.startMs`/`endMs`. The
parser also preserves optional `TextOffset` plus `WordLength`/`TextLength`
fields if the service returns them for a voice/model, so the reader can use
direct text spans. When Batch returns only the documented fields,
`enrichSpeechTimingSpans` aligns returned word-boundary text to the same reader
text that was sent to Azure. The stored-timing repair flow uses this same
enrichment policy: valid provider spans are retained, aligned spans are added,
non-zero-duration unmatched words receive a neighbouring span, and unalignable
zero-duration markers are omitted.

Safe dry-run examples:

```bash
npm run speech:batch -- --all --status PUBLISHED --limit 100 --dry-run
npm run speech:batch -- --all --source "Undark" --dry-run
```

Production examples:

```bash
# Lowest-storage web playback: MP3, 16 kHz, 32 kbps mono.
npm run speech:batch -- --all --status PUBLISHED --limit 100

# HD voice with an expressive style and conversational paragraph pauses.
npm run speech:batch -- --all --status PUBLISHED --limit 25 \
  --hd --style calm --style-degree 1.1 --paragraph-break-ms 650

# Rotate one voice per article from an explicit candidate list.
npm run speech:batch -- ARTICLE_ID \
  --voices en-US-AvaMultilingualNeural,en-US-AndrewMultilingualNeural \
  --sentence-break-ms 180
```

Important operator notes:

- Configure `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`; set
  `AZURE_SPEECH_ENDPOINT` to the Speech resource endpoint when using REST Batch
  Synthesis.
- `--all` selects public library articles (`visibility = PUBLIC`,
  `ownerId = null`) by default. Use explicit article ids, or pass
  `--include-private`, only when intentionally sending user/private article text
  to Azure Speech.
- Ensure media storage is available for batch runs. Local storage is the
  default; if `MEDIA_STORAGE=azure` is selected without credentials,
  `saveSpeechResult` skips cache persistence instead of writing audio to the
  database.
- The default batch output format is
  `audio-16khz-32kbitrate-mono-mp3` for broad browser playback with the lowest
  storage footprint. Pass `--format audio-24khz-48kbitrate-mono-mp3` or another
  Azure-supported MP3 format when quality should take priority over size.
- `--hd` uses the built-in English DragonHD preset and randomly selects one HD
  voice per article when no explicit `--voice` or `--voices` is supplied. Use
  `--list-hd-voices` to print the preset. HD voices, `mstts:express-as` styles,
  roles, and style degrees only work for Azure voices that support those SSML
  features. Treat this as experimental for Batch Synthesis: Azure documentation
  lists DragonHD as real-time only, and voice/region/API support can reject the
  job. Always test with `--limit 1` before starting a large HD batch.
- `--voices` supplies an explicit per-article voice candidate list. By default it
  rotates one voice per article; add `--voice-mode random` to randomly choose one
  candidate per article. Existing cache semantics still apply: each article has
  one active `ArticleSpeech` row, so regenerating with different voices overwrites
  the prior narration.
- Built-in English DragonHD preset used by `--hd`:
  - `en-US-Adam:DragonHDLatestNeural`
  - `en-US-Alloy:DragonHDLatestNeural`
  - `en-US-Andrew:DragonHDLatestNeural`
  - `en-US-Andrew2:DragonHDLatestNeural`
  - `en-US-Aria:DragonHDLatestNeural`
  - `en-US-Ava:DragonHDLatestNeural`
  - `en-US-Brian:DragonHDLatestNeural`
  - `en-US-Davis:DragonHDLatestNeural`
  - `en-US-Emma:DragonHDLatestNeural`
  - `en-US-Emma2:DragonHDLatestNeural`
  - `en-US-Jenny:DragonHDLatestNeural`
  - `en-US-Nova:DragonHDLatestNeural`
  - `en-US-Phoebe:DragonHDLatestNeural`
  - `en-US-Serena:DragonHDLatestNeural`
  - `en-US-Steffan:DragonHDLatestNeural`
- `--paragraph-break-ms` and `--sentence-break-ms` emit SSML `<break>` tags for
  conversational pauses.
- The Batch workflow never logs article text, SSML payloads, audio bytes, Azure keys, or
  result URLs. It logs article ids, counts, job ids, timing counts, and byte
  counts only.
- The Batch workflow supports multiple articles per Azure batch request: each article is
  one `inputs[]` item, and result files map back by Azure's numbered `[nnnn]`
  prefix. It chunks automatically at Azure's documented hard limits: 2 MB JSON
  request payload and 1,000 text input objects per batch job.
- `--max-chars` is not applied by default. Use it only when intentionally
  producing previews instead of full article audio. If a single article cannot
  fit inside the 2 MB request hard limit, the script fails that run instead of
  silently truncating content.

## Word-boundary collection

During synthesis, `provider-azure.ts` subscribes to
`sdk.SpeechSynthesizer.wordBoundary`. Each event yields:

- `audioOffset` (ticks, 100-nanosecond units) converted to
  `SpeechWord.startMs`.
- `duration` (ticks) converted and added to `startMs` to produce
  `SpeechWord.endMs`.
- `text` → stored as `SpeechWord.word`.
- Valid provider text offsets and lengths → stored as `textStart` and `textEnd`.

The collected words are sorted by `startMs` ascending before persisting. Reader
word highlighting uses the timing and reader-text spans from this sorted array.

A configurable timeout (`SPEECH_TIMEOUT_MS`, default 30 s) races the SDK call.
If the timeout fires, `synthesize` resolves `null` and the caller falls back.

## ArticleSpeech generation semantics

`getOrCreateArticleSpeech(articleId, context)` in `src/lib/speech/index.ts`:

1. **Access check** — non-operator callers must pass `getAiProcessableArticleById`.
   Operators bypass the check.
2. **Cache read** — looks up `ArticleSpeech` by `articleId`. Returns cached result
  if the timing payload parses cleanly, replaying its Narration text basis.
3. **Corrupt-cache recovery** — if `parseStoredSpeechTimingPayload` returns `null`, the
   corrupt row is deleted and synthesis retries from scratch.
4. **Fallback: no config** — if `speechConfig.get()` is null (Azure credentials
   absent), returns `{ audio: null, fallback: true }` without throwing.
5. **Fallback: empty text** — if `articleHtmlToReaderText` produces no text,
   returns the same graceful fallback.
6. **Synthesis** — calls `provider-azure.ts:synthesize`. Provider failure resolves
   null → fallback result.
7. **Persist** — calls `saveSpeechResult(...)` in `repository.ts`.
8. **Fallback: storage unavailable** — when synthesis succeeds but media storage
   cannot persist the audio, returns the generated data URL with
   `fallback: true` and `fallbackReason: "storage_unavailable"`. No
   `ArticleSpeech` cache row is written.

Fallback results (`fallback: true`) are **not** cached. The next call will retry
synthesis once Azure credentials or media storage recover. Background processing
records the speech step as a recoverable fallback so operators can backfill by
rerunning TTS jobs after fixing storage.

## Repository: saveSpeechResult

`saveSpeechResult` in `src/lib/speech/repository.ts` persists a synthesis result:

1. Calls `storage.put({ data, mimeType, keyHint: "speech", keyScope: articleId })`
   → `{ storageKey, sizeBytes, checksum }`.
2. Upserts a `MediaAsset` row recording the canonical `storageKey`, `mimeType`,
   `voice`, and `articleId`.
3. Atomically upserts `ArticleSpeech` with `mediaAssetId` and the V2 timing
  payload, including its Narration text basis descriptor, so the current audio,
  Reader text scope, and word timings remain paired.

If media storage is unavailable or the write fails, `saveSpeechResult` returns
`false`, skips cache persistence, and does not store audio in the database. The
caller may still return the just-generated audio to the current request, but it
must not report the result as durably cached.

## Repository: resolveStoredSpeechMedia

`resolveStoredSpeechMedia(row)` resolves playback metadata from the linked
current speech asset:

1. Loads `storageKey`, `mimeType`, and `voice` from `MediaAsset`.
2. Reads bytes via `storage.get(asset.storageKey)`.
3. Returns metadata with `audio: null` if storage cannot return the object.

## Cache invalidation and rebuild

Admin AI rebuild prepares Media asset retirement, deletes the `ArticleSpeech`
and associated `MediaAsset` rows in its transaction, then retires the collected
storage objects after the transaction commits.

The next call to `getOrCreateArticleSpeech` (reader request or
`TTS_GENERATE` background job) re-synthesizes with current config and persists a
fresh `ArticleSpeech` row.

## Privacy rules

- Do not log article text, derived narration text, or synthesized audio bytes.
- Persist only the Narration text basis descriptor, never Reader text itself.
- Do not expose `storageKey` values in API responses to clients.
- Treat absent Azure Speech credentials as normal; do not surface as an error.

## Access check

Reader-triggered speech follows the same access policy as AI processing:

- Operators (system context) bypass the article access check.
- Normal users must satisfy `getAiProcessableArticleById` — the article must be
  publicly listable or owned by the requesting user.

## Related docs

- [`../media/assets.md`](../media/assets.md) — `MediaAsset` schema, storage keys,
  content addressing, deletion, orphan handling.
- [`../media/storage.md`](../media/storage.md) — storage backends, migration,
  rollback, readiness.
- [`../reader/playback.md`](../reader/playback.md) — reader playback UX, how
  `ArticleSpeech` is consumed.
- [`../operations/tts-jobs.md`](../operations/tts-jobs.md) — TTS job scheduling,
  retry, rebuild.
