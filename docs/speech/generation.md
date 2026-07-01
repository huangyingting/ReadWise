---
title: "Speech generation"
category: "Speech"
architecture: "Documents TTS provider seam, request building, voice/format fallback, word-boundary collection, and ArticleSpeech generation."
design: "Captures current Azure Speech synthesis flow, cache/storage behavior, timing migration, readiness, and graceful fallback rules."
plan: "Update when Speech provider config, synthesis formats, ArticleSpeech schema, timing model, storage integration, or TTS jobs change."
updated: "2026-07-01"
rename: "none"
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
| `AZURE_SPEECH_ENDPOINT`     | REST batch script only; derived from region when unset |
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

## Azure Batch Synthesis CLI

Use `npm run speech:batch` for backend/offline narration jobs that should cover
full article text instead of the live-listening `MAX_TTS_CHARS = 5000` cap. The
script extracts DOM-order reader blocks with `articleHtmlToReaderBlocks`, submits
Azure Speech Batch Synthesis jobs, enables `wordBoundaryEnabled`, downloads the
result ZIP, parses `[nnnn].word.json`, and saves audio/timings through
`saveSpeechResult`.

Azure's Batch Synthesis result documentation shows `[nnnn].word.json` entries as
`Text`, `AudioOffset`, and `Duration` in milliseconds. The parser also preserves
optional `TextOffset` plus `WordLength`/`TextLength` fields if the service returns
them for a voice/model, so the reader can use direct text spans instead of token
alignment. When Batch returns only the documented fields, the script derives
`textStart`/`textEnd` spans by aligning returned word-boundary text back to the
same DOM-extracted `plainText` that was sent to Azure.

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
- Configure media object storage for large batch runs. If no storage backend is
  active, `saveSpeechResult` falls back to inline `ArticleSpeech.audioBase64`,
  which can make the application database very large.
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
- The script never logs article text, SSML payloads, audio bytes, Azure keys, or
  result URLs. It logs article ids, counts, job ids, timing counts, and byte
  counts only.
- The script supports multiple articles per Azure batch request: each article is
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
