---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the ReaderTools surface and its Reader, AI, Speech, Learning, Offline, and Analytics subsystem boundaries. Covers vocabulary, quiz, tutor, dictation, pronunciation, grammar, and selection tools as mounted reader panels/popovers with graceful fallbacks."
---

# Reader learning tools

The Reader learning tools are the stay-mounted panel and selection-popover tools
available while reading an article. They turn article context into practice and
support signals without changing article access rules or storing private content
in operational metadata.

This document is the feature-level companion to lower-level docs for dictionary,
translation, playback, speech generation, offline sync, and learning mastery.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Tool shell | `src/components/ReaderTools.tsx`, `ReaderToolsProvider.tsx`, `ReaderToolsSurface.tsx` | Floating panel, tab state, stay-mounted behavior, keyboard/focus surface. |
| Vocabulary tab | `src/components/ArticleVocabulary.tsx`, `src/components/reader/study/useArticleVocabularyPanel.ts` | Lazy article vocabulary generation/read, save/unsave integration. |
| Quiz tab | `src/components/ArticleQuiz.tsx`, `src/components/reader/study/useArticleQuizPanel.ts` | Lazy quiz fetch, answer state, history, attempt recording, offline queue fallback. |
| Tutor tab | `src/components/ArticleTutor.tsx`, `src/components/ReaderTutorProvider.tsx`, `src/components/tutor/*` | Grounded article chat, persisted successful turns, fallback/transient rows. |
| Dictation tab | `src/components/ArticleDictation.tsx`, `src/components/reader/study/useDictationPanel.ts`, `src/lib/dictation.ts` | Audio-range sentence playback plus local typed-word grading. |
| Pronunciation tab | `src/components/ArticlePronunciation.tsx`, `src/components/pronunciation/*`, `src/components/reader/usePronunciationAssessment.ts` | Browser-side Azure Speech pronunciation assessment and feedback. |
| Selection tools | `src/components/WordLookup.tsx`, `src/components/SelectionToolbar.tsx`, `src/components/GrammarPopover.tsx`, `src/components/SentenceTranslatePopover.tsx` | Dictionary, save word, highlights/notes, sentence translation, grammar explanation. |
| APIs | `/api/reader/[id]/vocabulary`, `/quiz`, `/quiz/attempt`, `/quiz/history`, `/tutor`, `/grammar`, `/translate-sentence`, `/dictionary`, `/pronunciation/*`, `/speech/token` | Authenticated, access-checked routes backing the UI. |
| Offline | `src/lib/offline/sync-runtime.ts`, `src/lib/offline/registry.ts` | Quiz-attempt replay, progress/highlight/save-word queues, conflict handling. |
| Learning signals | `src/lib/learning/*`, `src/lib/pronunciation.ts`, `src/lib/quiz-grading.ts` | Mastery, SRS, skill evidence, pronunciation history, quiz attempts. |

## Boundary rules

- The Reader owns UI composition and article-access context; it does not bypass
  Article Library visibility checks.
- AI owns prompt execution, structured output validation, cache versions, and
  graceful fallback content for vocabulary, quiz, tutor, grammar, and translation.
- Speech owns Azure Speech tokens, TTS generation, word timings, and audio bytes.
- Learning owns persisted practice outcomes and mastery signals.
- Offline owns client-side retry queues and idempotency; no server-side offline
  queue is introduced for Reader tools.

## Tool behavior

### Vocabulary

The Words tab calls `POST /api/reader/[id]/vocabulary` lazily when first opened.
It displays generated `word`, `explanation`, `example`, saved state, and
frequency tier. Save/unsave writes through `/api/vocabulary/save` and
`/api/vocabulary/unsave`, scoped to the authenticated user.

The panel is separate from dictionary lookup: dictionary lookup is selection
based and provider-backed, while article vocabulary is generated/cached article
enrichment. Both converge on `SavedWord` so the Study page and SRS queue see the
same explicit user study list.

### Quiz

The Quiz tab calls `POST /api/reader/[id]/quiz` and keeps answer state locally
until submission. Attempts are sent to `POST /api/reader/[id]/quiz/attempt` with
a `clientMutationId` and `x-client-mutation-id` header. The server grades
selected indices authoritatively against cached questions; the client score is
only UI feedback.

When the direct attempt write fails, the panel enqueues a `quiz.attempt` offline
mutation. `QuizAttempt.clientMutationId` makes replay idempotent, so a flaky
network cannot double-record a score. History is read from
`GET /api/reader/[id]/quiz/history`; learner-level summary is exposed at
`GET /api/quiz/mastery`.

### Tutor

The Ask tab is grounded to the current article and the learner profile. It loads
conversation context from `GET /api/reader/[id]/tutor`, posts questions to
`POST /api/reader/[id]/tutor`, and clears the per-article conversation through
`DELETE /api/reader/[id]/tutor`.

Only successful AI assistant responses are persisted. Fallback/unavailable turns
are transient UI rows and are not stored. Assistant answers render through the
safe markdown-light renderer: no `dangerouslySetInnerHTML` path is used.

Tutor context may include privacy-safe `LearnerCoachMemory` aggregate weakness
summaries. It must not include prompt text, article text beyond the authorized
context sent to the provider, selected text from unrelated interactions, notes,
credentials, or raw private content in metadata.

### Dictation

Dictation is local practice over existing narration timings. The panel warms
Reader narration, segments article plain text with speech word timings, plays a
single sentence range, and compares the learner's typed text with
`gradeDictation(reference, typed)`.

Grading is pure client/runtime logic: case and punctuation are ignored, a word
level edit-distance diff produces `correct`, `wrong`, `missing`, and `extra`
tokens, and accuracy is `correct reference words / reference word count`. No
dictation audio or typed answer is persisted by the current implementation.

### Pronunciation

Pronunciation is distinct from dictation. The browser requests a short-lived
Azure Speech authorization token from `GET /api/speech/token`, runs Azure Speech
SDK pronunciation assessment client-side, and posts only bounded scores and the
reference text to `POST /api/pronunciation/attempt`.

The server clamps `accuracyScore`, `fluencyScore`, `completenessScore`, and
`pronScore` to integers in `0..100`, validates optional article access, drops
unknown payload fields, and records pronunciation/listening skill evidence as a
best-effort side effect. History is read from
`GET /api/pronunciation/history?limit=N`.

### Grammar and sentence translation

The selection toolbar exposes Grammar for short phrases and sentence translation
for selected text. Grammar calls `POST /api/reader/[id]/grammar`; sentence
translation calls `POST /api/reader/[id]/translate-sentence`. Both are
access-checked and cache-oriented. UI popovers render plain text results and
surface graceful errors/fallbacks without logging selected text.

### Dictionary, save word, highlights, and notes

Selection lookup uses `POST /api/dictionary`, save/unsave uses the vocabulary
routes, and highlights/notes use the reader highlights APIs. These are detailed
in `lexical-dictionary.md`, `annotations.md`, and `offline-sync.md`.

## Offline behavior

| Tool | Current offline behavior |
| --- | --- |
| Quiz attempt | Queues failed attempt writes with `clientMutationId`; replay is idempotent. |
| Progress/highlights/saved words | Covered by the generic offline mutation queue. |
| Dictation | Works when narration and article payload are already available locally; no server write is required. |
| Vocabulary, tutor, grammar, translation | Require network/AI cache access for first load; existing UI state stays mounted while the tool surface is open/closed. |
| Pronunciation | Requires Speech token and browser Speech SDK availability; attempt persistence is online-only in the current implementation. |

## Privacy and deletion

Reader tools must not log or persist article text, selected text, prompts,
answers, definitions, translations, notes, raw audio, or credentials in metadata.
Persisted records are limited to user-owned rows such as `QuizAttempt`,
`SavedWord`, `Highlight`, `TutorMessage`, `PronunciationAttempt`, and cached
article-derived rows. User deletion cascades user-owned rows; non-FK operational
ledgers follow their own retention/erasure docs.

## Tests

Relevant coverage includes `tests/quiz*.test.ts`, `tests/tutor*.test.ts`,
`tests/dictation.test.ts`, `tests/pronunciation*.test.ts`,
`tests/vocabulary.test.ts`, `tests/grammar.test.ts`, `tests/offline-sync.test.ts`,
`tests/offline-conflict.test.ts`, and the reader/selection UI tests.

## Related docs

- [`lexical-dictionary.md`](./lexical-dictionary.md) — dictionary providers and saved words.
- [`annotations.md`](./annotations.md) — highlights and notes.
- [`translation.md`](./translation.md) — article and sentence translation.
- [`playback.md`](./playback.md) — Reader audio context and narration controls.
- [`../speech/pronunciation-practice.md`](../speech/pronunciation-practice.md) — Azure Speech assessment details.
- [`../learning/study-plan.md`](../learning/study-plan.md) — how practice outcomes feed weekly study recommendations.
