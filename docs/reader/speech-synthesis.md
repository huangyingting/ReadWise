---
title: "Speech synthesis and narration"
category: "Reader"
architecture: "Documents reader narration access checks, speech generation trigger, cache lifecycle, storage fallback, and streaming playback boundary."
design: "Captures current reader speech routes, Azure Speech provider seam, ArticleSpeech cache, media storage, and graceful fallback behavior."
plan: "Update when reader speech APIs, ArticleSpeech schema, Speech provider behavior, storage/audio endpoint, or playback UI changes."
updated: "2026-07-01"
rename: "none"
---

# Speech synthesis and narration

Speech synthesis generates cached narration audio and word timings for reader
playback. It is an optional feature: when Azure Speech is unconfigured or fails,
the reader receives a graceful fallback instead of an error.

For object-storage details, see [`../media/storage.md`](../media/storage.md).
For media asset lifecycle and ownership, see [`../media/assets.md`](../media/assets.md).
For reader playback UX (mini-player, word highlight, sentence loop), see [`playback.md`](./playback.md).
For TTS job scheduling and retry, see [`../operations/tts-jobs.md`](../operations/tts-jobs.md).
For the speech generation subsystem boundary and full provider seam detail, see [`../speech/generation.md`](../speech/generation.md).

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Orchestration | `src/lib/speech.ts` | Access check, cache read, synthesis, fallback result. |
| Azure provider | `src/lib/speech/provider-azure.ts` | SDK isolation, word-boundary collection, timeout handling. |
| Repository/storage | `src/lib/speech/repository.ts` | ArticleSpeech parsing, storage writes, MediaAsset upsert, corrupt-cache recovery. |
| Timings | `src/lib/speech-timing.ts` | Word timing utilities. |
| Runtime config | `src/lib/runtime-config/speech.ts` | Azure Speech env parsing, voice/format/timeouts. |
| Routes | `src/app/api/reader/[id]/speech/route.ts`, `src/app/api/reader/[id]/speech/audio/route.ts` | Generate/cache metadata and stream audio bytes. |

## Access and text basis

Reader-triggered speech uses the same article access policy as AI processing:
operators may process any article; normal users may process public-listable
articles and their own private imports.

Article text is derived with `articleHtmlToReaderText(...)`, then capped at
`MAX_TTS_CHARS = 5000`. This bounds latency, audio size, and provider cost.

## Cache lifecycle

`getOrCreateArticleSpeech(articleId, context)`:

1. verifies article access,
2. reads `ArticleSpeech` by `articleId`,
3. parses stored word timings,
4. deletes and regenerates corrupt cache rows,
5. returns cached audio URL/timings when valid,
6. returns fallback when speech config is missing or article text is empty,
7. synthesizes through Azure Speech on a miss,
8. persists audio/timings through `saveSpeechResult(...)`.

Fallback results have `audio = null`, empty `words`, `fallback = true`, and are
not cached.

## Provider boundary

`provider-azure.ts` is the only module that imports
`microsoft-cognitiveservices-speech-sdk`. It maps configured output formats to
SDK enums/MIME types, collects word-boundary events, closes the synthesizer on
success/error, and races the SDK call against `SPEECH_TIMEOUT_MS`.

Provider failures resolve `null`; callers decide the fallback UI.

## Storage and playback

`saveSpeechResult(...)` prefers configured object storage and records a
`MediaAsset` row with storage key, MIME type, byte size, checksum, duration,
voice, format, and article id. If storage is unconfigured or the write fails,
it falls back to `ArticleSpeech.audioBase64`.

`GET /api/reader/[id]/speech/audio` serves bytes from object storage when a
storage key is present, otherwise from base64. It must remain auth-gated and use
private cache headers.

## Rebuild and invalidation

Admin AI rebuild clears `ArticleSpeech` and speech `MediaAsset` pointers for the
article. The next reader request or background job regenerates narration with
current voice/format/config.

Changing voice or output format does not currently create a multi-voice cache;
the article has one active `ArticleSpeech` row.

## Privacy and operations

- Do not log article text or synthesized audio.
- Do not expose storage keys directly to clients.
- Treat missing Azure Speech config as normal unless narration is a deployment
  requirement.
- Use `/api/ready` for provider status and [`../media/storage.md`](../media/storage.md)
  for storage troubleshooting.

## Tests

Relevant tests include `tests/speech*.test.ts`, `tests/media-storage*.test.ts`,
`tests/assets.test.ts`, and route tests for the speech endpoints.
