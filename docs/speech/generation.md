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

**Speech subsystem owns** the TTS provider seam, SSML/text request building,
voice and output-format selection and fallback, word-boundary event collection,
Azure SDK isolation, `ArticleSpeech` cache creation and invalidation, and the
`saveSpeechResult` / `resolveStoredAudioUrl` repository functions.

**Speech does not own** storage backend selection or migration (owned by Media),
reader playback UX (owned by Reader), or job retry scheduling (owned by
Operations).

## Code map

| File | Purpose |
| ---- | ------- |
| `src/lib/speech/index.ts` | Public entry point. Exports `getOrCreateArticleSpeech`, timing/practice utilities, and `SpeechResult` type. |
| `src/lib/speech/provider-azure.ts` | Azure SDK isolation — the only module that imports `microsoft-cognitiveservices-speech-sdk`. |
| `src/lib/speech/repository.ts` | ArticleSpeech DB reads/writes, corrupt-cache recovery, `MediaAsset` upsert, storage interaction. |
| `src/lib/speech/timing.ts` | Word-timing types and utilities (`SpeechWord`, `timingStartSeconds`, `timingEndSeconds`). |
| `src/lib/speech/timing-alignment.ts` | Token alignment for word-highlight mapping. |
| `src/lib/speech/practice.ts` | Sentence segmentation for practice tools. |
| `src/lib/runtime-config/speech.ts` | Azure Speech env parsing: key, region, voice, format, timeout. |

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

Article text is prepared by `articleHtmlToReaderText(article.content)` (HTML
stripped, reader-safe text extracted), then capped at `MAX_TTS_CHARS = 5000`
characters. This bound limits:

- Azure Speech latency and per-request cost.
- Audio file size stored in the database or object storage.
- Word-boundary array size in `ArticleSpeech.words`.

The capped plain text is stored in `ArticleSpeech.plainText` for re-use on
cache hits without re-processing the article HTML.

## Voice and format selection

Voice and output format are read from environment variables via
`src/lib/runtime-config/speech.ts`:

| Variable                    | Default                                    |
| --------------------------- | ------------------------------------------ |
| `AZURE_SPEECH_VOICE`        | `en-US-AndrewMultilingualNeural`           |
| `AZURE_SPEECH_OUTPUT_FORMAT`| `audio-24khz-96kbitrate-mono-mp3`          |
| `SPEECH_TIMEOUT_MS`         | `30000`                                    |

**Voice fallback:** when `AZURE_SPEECH_VOICE` is unset, `DEFAULT_SPEECH_VOICE`
is used. The voice is recorded in both `MediaAsset.voice` and
`ArticleSpeech.voice` so the reader can display it.

**Format fallback:** when `AZURE_SPEECH_OUTPUT_FORMAT` is unset or unrecognised
by `resolveOutputFormat`, the function falls back to
`Audio24Khz96KBitRateMonoMp3` / `audio/mpeg`. Supported format strings are
defined in the `map` inside `provider-azure.ts`.

**No multi-voice cache:** an article has exactly one active `ArticleSpeech` row.
Changing voice or format does not retain the previous narration; the next
synthesis request overwrites it.

## Word-boundary collection

During synthesis, `provider-azure.ts` subscribes to
`sdk.SpeechSynthesizer.wordBoundary`. Each event yields:

- `audioOffset` (ticks, 100-nanosecond units) → converted to milliseconds →
  stored as `SpeechWord.offset`.
- `duration` (ticks) → converted to milliseconds → stored as
  `SpeechWord.duration`.
- `text` → stored as `SpeechWord.word`.

The collected words are sorted by `offset` ascending before persisting. Reader
word-highlight uses binary search on this sorted array.

A configurable timeout (`SPEECH_TIMEOUT_MS`, default 30 s) races the SDK call.
If the timeout fires, `synthesize` resolves `null` and the caller falls back.

## ArticleSpeech generation semantics

`getOrCreateArticleSpeech(articleId, context)` in `src/lib/speech/index.ts`:

1. **Access check** — non-operator callers must pass `getAiProcessableArticleById`.
   Operators bypass the check.
2. **Cache read** — looks up `ArticleSpeech` by `articleId`. Returns cached result
   if the row exists and word timings parse cleanly.
3. **Corrupt-cache recovery** — if `parseStoredSpeechWords` returns `null`, the
   corrupt row is deleted and synthesis retries from scratch.
4. **Fallback: no config** — if `speechConfig.get()` is null (Azure credentials
   absent), returns `{ audio: null, fallback: true }` without throwing.
5. **Fallback: empty text** — if `articleHtmlToReaderText` produces no text,
   returns the same graceful fallback.
6. **Synthesis** — calls `provider-azure.ts:synthesize`. Provider failure resolves
   null → fallback result.
7. **Persist** — calls `saveSpeechResult(...)` in `repository.ts`.

Fallback results (`fallback: true`) are **not** cached. The next call will retry
synthesis once Azure credentials are configured.

## Repository: saveSpeechResult

`saveSpeechResult` in `src/lib/speech/repository.ts` persists a synthesis result:

1. If object storage is configured (`getMediaStorage()` returns non-null):
   - Calls `storage.put({ data, mimeType, keyHint: "speech" })` → `{ storageKey, sizeBytes, checksum }`.
   - Upserts a `MediaAsset` row recording `storageKey`, `mimeType`, `sizeBytes`,
     `checksum`, `durationSec`, `voice`, `format`, `articleId`.
   - Sets `audioBase64 = null` on the `ArticleSpeech` row (audio is durably stored
     externally).
2. If storage is unconfigured or the write fails:
   - Falls back to writing `audioBase64` inline in `ArticleSpeech`.
   - No `MediaAsset` row is created.
3. Upserts `ArticleSpeech` with `storageKey`, `mediaAssetId`, `mimeType`, `voice`,
   `format`, `plainText`, `words`.

## Repository: resolveStoredAudioUrl

`resolveStoredAudioUrl(row)` resolves a playable `data:` URL from a cached row:

1. Prefers `row.audioBase64` (inline fallback column).
2. Falls back to reading bytes from storage via `storage.get(row.storageKey)`.
3. Returns `null` if neither is available (e.g. storage unreachable after migration).

## Cache invalidation and rebuild

Admin AI rebuild (`adminRebuildArticleAI`) deletes the `ArticleSpeech` row and
the associated `MediaAsset` row. The storage object is retained (not deleted by
the rebuild). See [`../media/assets.md`](../media/assets.md) for orphan handling.

The next call to `getOrCreateArticleSpeech` (reader request or
`TTS_GENERATE` background job) re-synthesizes with current config and persists a
fresh `ArticleSpeech` row.

## Privacy rules

- Do not log article text, the `plainText` field, or synthesized audio bytes.
- Do not expose `storageKey` values in API responses to clients.
- Treat absent Azure Speech credentials as normal; do not surface as an error.

## Access check

Reader-triggered speech follows the same access policy as AI processing:

- Operators (system context) bypass the article access check.
- Normal users must satisfy `getAiProcessableArticleById` — the article must be
  publicly listable or owned by the requesting user.

## Related docs

- [`../media/assets.md`](../media/assets.md) — `MediaAsset` schema, storage keys,
  checksums, deletion, orphan handling.
- [`../media/storage.md`](../media/storage.md) — storage backends, migration,
  rollback, readiness.
- [`../reader/playback.md`](../reader/playback.md) — reader playback UX, how
  `ArticleSpeech` is consumed.
- [`../operations/tts-jobs.md`](../operations/tts-jobs.md) — TTS job scheduling,
  retry, rebuild.
