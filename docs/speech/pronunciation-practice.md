---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the client-side Azure Speech pronunciation-assessment flow, token exchange route, persistence route, and Learning mastery side effects. Audio assessment runs in the browser with a short-lived Speech token; the server stores bounded scores and reference text only, never raw audio or SDK word/phoneme payloads."
---

# Pronunciation practice

Pronunciation practice is the Reader Speak tab. It lets learners read selected
sentences aloud and receive Azure Speech SDK assessment feedback while keeping
server persistence intentionally narrow.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Reader panel | `src/components/ArticlePronunciation.tsx` | Orchestrates Speak tab UI states and session flow. |
| UI components | `src/components/pronunciation/*` | Sentence display, recording controls, score ring, sub-score bars, word bands. |
| Assessment hook | `src/components/reader/usePronunciationAssessment.ts` | Browser-side Azure Speech SDK integration. |
| Speech token | `src/app/api/speech/token/route.ts` | Exchanges server-held Speech key for a short-lived client token. |
| Persistence | `src/app/api/pronunciation/attempt/route.ts`, `src/lib/pronunciation.ts` | Validates and stores bounded attempt scores. |
| History | `src/app/api/pronunciation/history/route.ts` | Newest-first attempt history and aggregate stats. |
| Learning side effects | `src/lib/learning/skill-mastery.ts`, `src/lib/learning/primitives.ts` | Best-effort pronunciation/listening skill evidence. |
| Speech config | `src/lib/runtime-config/speech.ts` | Azure Speech key/region/voice/format/timeout. |

## Token exchange

`GET /api/speech/token` requires an authenticated session and applies the lookup
rate limit. When Speech credentials are absent, it returns `200` with
`{ configured: false }` so the UI can hide or degrade the feature.

When configured, the route calls Azure STS with `AZURE_SPEECH_KEY` and returns:

- `configured: true`;
- `token`: short-lived authorization token;
- `region`: Azure Speech region.

The Azure Speech key is never sent to the browser.

## Client-side assessment

The pronunciation assessment runs in the browser through the Azure Speech SDK.
This is intentional:

- the recorded microphone audio is not uploaded to ReadWise servers;
- browser UI can show word-level bands and sub-score feedback immediately;
- server persistence does not need provider-specific word/phoneme payloads.

The Speak tab segments practisable article sentences and guides the learner
through recording, feedback, retry, and next-sentence states.

## Attempt persistence

`POST /api/pronunciation/attempt` accepts:

| Field | Validation |
| --- | --- |
| `referenceText` | non-empty, max 2000 chars. |
| `accuracyScore` | integer clamped to `0..100`. |
| `fluencyScore` | integer clamped to `0..100`. |
| `completenessScore` | integer clamped to `0..100`. |
| `pronScore` | integer clamped to `0..100`. |
| `articleId` | optional; when present, must be readable by the user. |

Unknown fields are dropped by schema validation, so raw SDK word arrays,
phoneme details, audio blobs, or provider payloads are not persisted.

The route returns the saved attempt plus the user's all-time best `pronScore`.

## History

`GET /api/pronunciation/history?limit=N` returns only the authenticated user's
attempts, newest first, capped to `1..100` rows. It also returns:

- `attemptCount`;
- `bestPronScore`;
- rounded `averageScore`.

History rows include the reference text because it is user-facing practice
history. Do not copy that text into logs, analytics properties, audit metadata,
or AI ledger metadata.

## Learning integration

After a successful attempt write, the route records best-effort skill evidence:

- `pronScore / 100` for the `pronunciation` skill;
- `accuracyScore / 100` with lower weight for the `listening` skill.

These side effects must never break the attempt write. If mastery update fails,
the pronunciation attempt still succeeds.

## Privacy and safety

- Raw microphone audio is not stored by ReadWise.
- Azure Speech credentials stay server-side; the client receives only a short
  token.
- Persisted attempts contain user id, optional article id, reference text, four
  bounded scores, and timestamps.
- Do not log reference text, Speech tokens, SDK payloads, or provider errors that
  could contain sensitive request details.
- User deletion cascades pronunciation attempts.

## Relationship to TTS generation

Pronunciation practice uses Azure Speech SDK assessment and `/api/speech/token`.
It is separate from text-to-speech narration generation documented in
[`generation.md`](./generation.md). Narration creates `ArticleSpeech`/`MediaAsset`
rows; pronunciation attempts create `PronunciationAttempt` rows.

## Tests

Relevant tests include `tests/pronunciation-lib.test.ts`,
`tests/pronunciation-routes.test.ts`, `tests/pronunciation-speech-token.test.ts`,
`tests/practice-attempts.test.ts`, `tests/dictation.test.ts`, and Speech provider
configuration tests.

## Related docs

- [`generation.md`](./generation.md) — TTS narration generation.
- [`../reader/reader-tools.md`](../reader/reader-tools.md) — Reader Speak and Dictation UX context.
- [`../learning/learning-and-mastery.md`](../learning/learning-and-mastery.md) — skill mastery formulas.
- [`../platform/runtime-config.md`](../platform/runtime-config.md) — Speech environment variables and feature switches.
