---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents client-side offline mutation queue, conflict resolution, cache versioning, Today offline replay, and push/background-sync resilience. Captures current IndexedDB queue, idempotency keys, retry/backoff, conflict statuses, service-worker cache versions, and privacy purge behavior."
---

# Offline-first sync, conflict resolution & cache versioning

This document describes the offline-first work added in Epic **RW-E008**
(**RW-042** offline mutation queue, **RW-043** conflict resolution, **RW-044**
cache versioning & invalidation, **RW-045** push reminder / background-sync
resilience). It builds on the existing PWA infra (`public/sw.js`,
`src/lib/offline/idb.ts`, the offline article download) rather than replacing it.

The design goal: a reader can keep reading, highlighting, note-taking, saving
words and finishing quizzes **while offline**, and have those changes converge
correctly with the server (and with edits made on other devices) once
connectivity returns — without double-applying, silently losing text, or
breaking offline reading across a service-worker upgrade.

---

## 1. Client-side mutation queue (RW-042)

### Storage — `src/lib/offline/idb.ts`

The existing IndexedDB helper (`readwise-offline`) is bumped to `DB_VERSION = 2`
and gains a `mutations` object store alongside the existing offline-article
store. Each queued mutation row is:

```ts
{
  id: number,               // auto-increment, also the FIFO key
  type: string,             // logical mutation kind (e.g. "progress", "highlight.update")
  endpoint: string,         // URL to POST/PATCH/DELETE
  method: string,
  body: unknown,            // JSON payload
  clientMutationId: string, // idempotency key (see below)
  dedupeKey?: string,       // collapses superseded mutations (e.g. "progress:<articleId>")
  status: "pending" | "inflight" | "failed",
  retryCount: number,
  createdAt: number,
  updatedAt: number,
}
```

`dedupeKey` lets a newer mutation **replace** a stale queued one (e.g. only the
latest reading-progress value for an article needs to survive — older percents
are forward-only-dominated anyway).

### Sync engine — `src/lib/offline-sync.ts` (pure) + `src/lib/offline/sync-runtime.ts` / `src/lib/offline/mutation-store.ts` (glue)

`offline-sync.ts` holds the **pure, unit-tested** flush logic with no IndexedDB
or `fetch` imports:

| Helper | Purpose |
| --- | --- |
| `classifyStatus(status)` | Maps an HTTP status to `"ok"` / `"retry"` / `"permanent"`. 2xx → ok; 408/425/429/5xx → retry; other 4xx → permanent (drop, don't loop). |
| `backoffDelay(retryCount, base, max, rng?)` | Full-jitter exponential backoff: `round(exp/2 + rng()*(exp/2))` where `exp = min(max, base·2^retryCount)`. |
| `sortQueue(rows)` | Stable FIFO order by `createdAt` then `id`. |
| `isPermanentlyFailed(row, maxRetries)` | True once `retryCount >= maxRetries` (`MAX_MUTATION_RETRIES = 5`). |
| `flushQueue(rows, deps)` | Drives the whole flush against injectable `send`/`onResult` deps — testable without a browser. |

`offline-mutations.ts` is the browser glue: `submitMutation(spec)` sends
directly when online and **enqueues** (IndexedDB) when offline or on a network
throw; `flushOfflineQueue()` drains the queue with retry/backoff;
`registerOfflineSync()` wires the `online` event + the service-worker
`sync` message; `subscribeSyncState()/getSyncState()` expose
`{ online, pending, syncing }` to the UI.

### Idempotency

Every queued mutation carries a `clientMutationId` (`newClientMutationId()`,
a UUID) sent both in the body and as the `x-client-mutation-id`
(`MUTATION_HEADER`) header, so a re-sync after a flaky response can't
double-apply:

| Mutation | Idempotency mechanism |
| --- | --- |
| Reading progress | Forward-only `saveProgress` — replaying a lower/equal percent is a no-op. |
| Saved word save | Upsert on the `@@unique([userId, word])` constraint. |
| Saved word unsave | `deleteMany` — deleting an already-deleted row is a no-op. |
| Highlight create | Upsert on `(userId, articleId, startOffset, endOffset)`. |
| Highlight update/delete | Targets a stable id; PATCH/DELETE are naturally idempotent. |
| **Quiz attempt** | `QuizAttempt.clientMutationId @unique` — `recordQuizAttempt` does find-by-mutation-id-then-create and is P2002-safe, so a replay returns the original attempt instead of inserting a duplicate. |

### Reader learning-tool coverage

Reader tools have different offline semantics:

| Tool | Offline behavior |
| --- | --- |
| Quiz attempt | Direct POST failure queues `quiz.attempt` with `clientMutationId`; replay is idempotent. |
| Dictation | Works locally when article payload and narration timings are already available; no server write is required. |
| Progress, highlights, notes, saved words | Use the generic offline mutation queue and conflict rules described in this document. |
| Vocabulary, tutor, grammar, translation | Require network/provider/cache access for first load; mounted UI state is preserved, but no offline AI generation queue exists. |
| Pronunciation | Requires a Speech token and browser Speech SDK; attempt persistence is online-only in the current implementation. |

The full Reader tool contract is documented in [`reader-tools.md`](./reader-tools.md).

### UI — `src/components/OfflineSyncIndicator.tsx`

A small fixed-position badge (mounted once in `src/app/layout.tsx`) subscribes
to the sync state and shows Offline / Syncing / “N pending”, with a **Sync now**
button. The reader's existing client mutations (`ReaderProgress`, `ArticleQuiz`,
`ReaderHighlightsProvider`, `InlineNoteEditor`) now send directly when online and
enqueue through `submitMutation` when offline or on fetch failure — keeping their
optimistic UI state instead of reverting.

---

## 2. Conflict resolution (RW-043)

All rules live in `src/lib/offline-conflict.ts` as **pure functions** (no Prisma
/ network), so the multi-device scenarios are unit-tested directly. No new
version columns were added — conflict resolution reuses each model's existing
`updatedAt`.

| Data type | Rule | Helper |
| --- | --- | --- |
| **Reading progress** | **Forward-only.** The stored percent never decreases and completion is sticky. The server's `saveProgress` already enforces this; `resolveProgress` mirrors it client-side for optimistic merges. | `resolveProgress` |
| **Saved words / sentence translations** | **Last-write-wins** by `updatedAt` (ties favour the already-persisted server value). | `resolveLastWriteWins` |
| **Highlights** | **Anchor revalidation.** When sanitized article content changes so a highlight's stored quote no longer sits at its offsets, the highlight is flagged **stale** (and re-anchored when the quote is found elsewhere) — it is never silently dropped. | `revalidateAnchor` |
| **Notes** (highlight annotations) | **Last-write-wins, but text is never lost.** If the server note changed since the offline edit, both versions are preserved in a merged note (separated by `NOTE_CONFLICT_SEPARATOR`) for the user to clean up. | `mergeNoteConflict` |

### Highlight anchor revalidation

`revalidateAnchor(quote, content, expectedOffset)` returns one of:

- `valid` — the quote still sits at its recorded offsets.
- `moved` — the quote moved; suggested new offsets are returned so the highlight
  re-anchors.
- `missing` — the quote is gone; the highlight is marked stale for the user.

The search is tiered for resilience to sanitiser/whitespace reflow: exact
offset slice → prefix/suffix context match → plain `indexOf` →
whitespace-tolerant regex (`tokens.join("\\s+")`). The GET highlights route
(`/api/reader/[id]/highlights`) annotates each returned highlight with its
anchor status via `annotateHighlightAnchors`.

### Note conflict UX

`updateHighlight` accepts a `baseUpdatedAt` (the `updatedAt` the client last
saw). If the server row is newer, it returns `{ ok, highlight, conflict: true }`
with a merged note instead of overwriting. `ReaderHighlightsProvider` keeps the
optimistic text and announces the merge; `InlineNoteEditor` enqueues the PATCH
on failure and keeps the user's text.

---

## 2a. Today Session offline mutations (#811)

Today Session step actions can be queued offline and replayed into the existing,
idempotent Today API routes. The queue is **client-only** (IndexedDB) — no new
Prisma model or server-side offline queue is introduced. The server resolves
today's primary article from the stored `TodaySession` for the `(userId,
localDate)` pair, so **no article/word ids or content ever enter the queue**.

### Mutation types — `src/lib/offline/registry.ts`

| Type | Endpoint | Method | Idempotency key | Dedupe |
| --- | --- | --- | --- | --- |
| `today.skip` | `/api/today/skip` | `POST` | `today-skip-{userId}-{localDate}` | append-only |
| `today.read-complete` | `/api/today/read-complete` | `POST` | `today-read-{userId}-{localDate}` | latest-wins |
| `today.comprehension` | `/api/today/comprehension` | `POST` | `today-comp-{userId}-{localDate}` | latest-wins |
| `today.word-review-complete` | `/api/today/word-review-complete` | `POST` | `today-review-{userId}-{localDate}` | latest-wins |

The idempotency key is derived from the mutation type, the **authenticated
`userId`** (never read from the payload), and the learner's local date, so a
repeated same-day action collapses to one queued record. `buildTodayIdempotencyKey`
mints the key; `TODAY_ENDPOINT_BY_TYPE` maps each type to its route. The
`today.word-review-complete` route is a thin wrapper over the existing
`markTodayWordReviewComplete` so offline replay has a real endpoint.

### Payload privacy

A Today offline payload may contain **only** these controlled fields
(`TODAY_OFFLINE_PAYLOAD_FIELDS`, enforced by `isAllowedTodayPayload`):

`localDate` (`YYYY-MM-DD`), `timezone` (IANA), `skipReason` (controlled enum),
`selfRating` (controlled enum), `questionId` (id), `selectedIndex` (MCQ index),
`mcqCorrect` (bool).

**Banned:** article/word text, definitions, prompts, answer/question text,
notes, tokens, credentials, or any PII. (The MCQ answer is replayed as a bare
`selectedIndex`; grading stays server-side — the client never holds the answer
key — so no content leaves the browser.)

### Replay & conflict resolution — `src/lib/offline/sync-runtime.ts`

`todayMutationReplayHandler(mutation, deps)` replays one Today mutation with
Today-specific conflict semantics (unlike the generic engine, a `409` here is a
genuine conflict, not a resolved no-op):

1. Validate `localDate`/`timezone` and that the payload carries **only** allowed
   fields — a malformed/content-bearing payload is marked `failed`, never sent.
2. `2xx` (including idempotent no-ops) → remove from the queue.
3. `409` → mark the mutation **`conflict`** and emit the content-free
   `today_offline_conflict` event (`{ mutationType, statusCode }` only) for the
   analytics + the non-blocking toast.
4. Network error / `5xx` / `408` / `429` → increment `retryCount` (existing
   exponential back-off); flag `failed` once retries are exhausted.
5. Other `4xx` → permanent `failed`.

`flushOfflineQueue` drains Today mutations through this handler first, then runs
the generic `flushQueue` for everything else. A new `conflict` `MutationStatus`
is added; both `flushQueue` and the Today drain skip `conflict` records.

| Conflict scenario | Resolution | UI |
| --- | --- | --- |
| Offline skip; same day already completed online on another device (server returns `409`) | Mark mutation `conflict`; never overwrite the completed session | Non-blocking "your progress is safe" notice |
| Offline read-complete; primary article swapped online | Server hook is a no-op when the article id doesn't match → `200` idempotent no-op | Silent; learner sees current Today state |
| Two devices queue `today.word-review-complete` for the same day | `wordReviewCompletedAt` is monotonic (first write wins; second is a `200` no-op) | No conflict UI needed |

### UI — `TodayWorkflow` / `TodayComprehensionCheck`

When `navigator.onLine === false`, the skip / mark-read / comprehension actions
are enqueued via `submitTodayMutation` (`src/lib/offline/today-client.ts`)
instead of a direct fetch, and a non-blocking "saved offline, will sync" notice
is shown. The components subscribe to `subscribeTodayConflicts` and render a
non-blocking conflict notice when a replayed action conflicted — never a
blocking error dialog and never data loss.

---

## 3. Cache versioning & invalidation (RW-044)

Pure logic lives in `src/lib/cache-version.ts`; the runtime lives in
`public/sw.js` (which **cannot import ES modules**, so `SW_CACHE_VERSION` is
mirrored there manually and must stay in sync).

### Versioned offline payloads

| Constant | Value | Meaning |
| --- | --- | --- |
| `OFFLINE_PAYLOAD_VERSION` | `2` | Schema version of the cached article payload. |
| `SW_CACHE_VERSION` | `"v3"` | Service-worker cache-name suffix. |

`/api/reader/[id]/offline` returns `version` (`OFFLINE_PAYLOAD_VERSION:updatedAt:contentHash`)
and a `contentHash` (FNV-1a over sanitized content). `?meta=1` returns just the
metadata so a client can cheaply check staleness without re-downloading.

- `makeArticleVersion(input)` builds the composite version string.
- `contentHash(text)` is a fast, dependency-free FNV-1a hash.
- `isOfflineStale(stored, server)` compares stored vs server version /
  payload-version to decide a refresh.
- `staleCacheNames(names, current)` returns SW cache names to delete on upgrade.

`OfflineDownloadButton` calls `revalidateCachedCopy()` on mount: it compares the
stored version against the server's via `?meta=1`, re-downloads when stale, and
removes the cached copy on a `404` (deleted article).

### Service-worker upgrade safety — `public/sw.js`

- `install` pre-caches the shell and (deliberately) does **not** force-activate.
- `activate` deletes every cache whose name isn't the current `SW_CACHE_NAME`
  (via the same `staleCacheNames` logic) then `clients.claim()`s — so an upgrade
  cleans old caches without breaking an in-progress offline read.
- A `SKIP_WAITING` message lets the client opt into an immediate upgrade.
- The `sync` event (tag `readwise-mutations`) posts a flush message to clients,
  which own IndexedDB-queue access.

### Privacy purge on sign-out / account deletion

`purgeOfflineUserData()` (in `offline-mutations.ts`) clears the IndexedDB stores
**and** messages the service worker to drop private caches. It runs **before**
client sign-out flows and from the account-deletion flow (`AccountDangerZone`),
so private/offline content never lingers after a user leaves. Server-side,
`ReminderPreference` (and all other per-user rows) cascade on account deletion —
no extra cleanup code needed.

---

## 4. Push reminder & background-sync resilience (RW-045)

### Delivery tracking & pruning — `src/lib/push/`

`PushSubscription` gained additive columns `failureCount`, `lastSuccessAt`,
`lastFailureAt`. `sendToSubs` now:

- deletes subscriptions the push service reports dead (`404` / `410`);
- on success resets `failureCount → 0` and stamps `lastSuccessAt`;
- on a transient failure increments `failureCount` and stamps `lastFailureAt`,
  and **prunes** the subscription once it reaches
  `MAX_CONSECUTIVE_FAILURES = 8` consecutive failures.

### Reminder preferences & quiet hours — `src/lib/reminder-preferences.ts`

A new `ReminderPreference` model (1-1 with `User`) persists
`enabled`, `preferredHour`, `quietHoursStart`, `quietHoursEnd`, `timezone`.
Pure helpers:

- `validateReminderPreference(input)` — validates/normalises the payload.
- `isWithinQuietHours(hour, start, end)` — handles wrap-around windows
  (e.g. 22→7).
- `shouldSendNow(pref, localHour)` — gates on `enabled`, `preferredHour`, and
  quiet hours.
- `localHourInTimeZone(date, tz)` — the user's local hour via `Intl`.

`sendDueReminders` loads each user's preference + profile timezone, computes
their local hour, and **suppresses** sends outside the preferred time / inside
quiet hours (reported via `ReminderResult.suppressed`; surfaced by
`scripts/push-reminders.ts`). Preferences are read/written through
`GET|PUT /api/push/preferences`; the UI is `ReminderPreferencesForm` in the
settings Notifications card.

---

## 5. Schema decision

Changes were kept **minimal and additive**, appended at the end of **both**
`prisma/schema.prisma` and `prisma/postgresql/schema.prisma`, with hand-authored
migrations mirrored in **both** migration dirs
(`20260623120000_offline_sync_rwe008`):

- `QuizAttempt.clientMutationId String? @unique` — quiz-attempt idempotency.
- `PushSubscription.failureCount Int @default(0)`, `lastSuccessAt DateTime?`,
  `lastFailureAt DateTime?` — delivery tracking.
- New `ReminderPreference` model (1-1 with `User`, `onDelete: Cascade`).

Conflict resolution deliberately **reuses existing `updatedAt` columns** — no
version columns were added.

---

## 6. Testing

Client-only code (IndexedDB / service worker) isn't exercised by the Node test
runner, so the **pure** logic is unit-tested directly:

- `tests/offline-sync.test.ts` — queue ordering, status classification, backoff,
  permanent-failure detection, `flushQueue` happy/retry/drop paths.
- `tests/offline-conflict.test.ts` — progress forward-only, last-write-wins,
  anchor revalidation (valid/moved/missing + whitespace reflow), note merge
  preserves both texts.
- `tests/cache-version.test.ts` — version composition, staleness compare,
  cache-name pruning.
- `tests/reminder-preferences.test.ts` — validation, quiet-hours wrap-around,
  `shouldSendNow`, mocked-Prisma accessors.
- `tests/push.test.ts` — extended for delivery tracking, threshold pruning, and
  quiet-hours suppression.
