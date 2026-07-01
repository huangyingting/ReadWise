---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the durable per-learner local-day TodaySession workflow anchor and its plan/completion/offline boundaries. Captures current daily generation, primary/backup article ids, comprehension checks, saved-word targets, reflection, local-date semantics, and privacy constraints."
---

# Today Session

Today Session is the durable workflow anchor for **one stable learner-local
day**. It gives each learner a single, idempotent daily plan — what to read,
what backups to fall back to, and a short set of vocabulary words to review —
without duplicating any learning content into a new table.

- **Owning subsystem:** Learning / Engagement
  (`src/lib/engagement/today-session/`)
- **Schema:** `TodaySession` and `TodayComprehensionFeedback` models in
  `prisma/base.prisma`

## Purpose

The Reader needs a deterministic "what should I do today?" surface that:

- anchors on the learner's **local calendar day**, not a fixed UTC window, so an
  evening reader whose day straddles UTC midnight still gets one coherent day;
- is **idempotent** — every load on the same local day returns the **same**
  plan, even under concurrent first-loads;
- **stores anchors and identifiers only** — article ids, saved-word ids,
  controlled statuses, and timestamps — and **never** learning content (no
  article text, word text, definitions, examples, context sentences, prompts, or
  private notes).

Today owns **orchestration**. It does not re-implement scoring: new-article
candidates come from Recommendations (`listScoredPicksPage`), and Today simply
chooses among resume vs. Picks vs. an empty browse/import state.

## Data model

`TodaySession` (see `prisma/base.prisma`). One row per `(userId, localDate)`,
enforced by `@@unique([userId, localDate])` and indexed by `userId`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` cuid | Primary key |
| `userId` | `String` | FK → `User`, `onDelete: Cascade` |
| `localDate` | `String` | `YYYY-MM-DD` in the learner's local calendar — **not** a UTC `DateTime` bucket |
| `timezoneSnapshot` | `String` | IANA zone used to derive `localDate` |
| `primaryArticleId` | `String?` | The day's main article id; `null` in the no-candidate state |
| `backupArticleIds` | `Json` (`string[]`) | Stable backup article ids for the day; no current/duplicate |
| `targetSavedWordIds` | `Json` (`string[]`) | `SavedWord` ids selected for review — **ids only** |
| `reviewTargetCount` | `Int` (default 0) | Count of target words (0 is valid) |
| `status` | `String` | Controlled: `active` \| `completed` \| `skipped` |
| `source` | `String` | Controlled: `resume` \| `picks` \| `none` \| `user_selected` |
| `completionTier` | `String` | Controlled: `none` \| `reading` \| `comprehension` \| `full` |
| `generationReasonCode` | `String` | Controlled: `resume_in_progress` \| `picks_primary` \| `no_candidate` |
| `readingCompletedAt` | `DateTime?` | Set when the reading step completes |
| `comprehensionCompletedAt` | `DateTime?` | Set when comprehension completes |
| `wordReviewCompletedAt` | `DateTime?` | Set when word review completes |
| `completedAt` | `DateTime?` | Set when the whole session completes |
| `skipped` | `Boolean` (default false) | True when the learner skips the day |
| `skipReason` | `String?` | Controlled when set: `not_interested` \| `too_busy` \| `too_hard` \| `too_easy` \| `other` |
| `skippedAt` | `DateTime?` | When the day was skipped |
| `createdAt` / `updatedAt` | `DateTime` | Timestamps |

### Lightweight comprehension feedback

`TodayComprehensionFeedback` stores the optional post-reading self-check for a
Today session. It is one controlled feedback row per submitted session and
carries only ids/enums/booleans:

| Field | Notes |
| --- | --- |
| `userId` | FK → `User`, `onDelete: Cascade` |
| `todaySessionId` | Plain string reference to the Today session; not an FK |
| `articleId` | Primary article id at submission time; not an FK |
| `selfRating` | Controlled: `confident` \| `partial` \| `confused` |
| `questionId` | Optional `QuizQuestion.id` shown to the learner; no question text is stored in this row |
| `mcqCorrect` | `true` / `false` when an MCQ was graded; `null` for self-rating-only checks |
| `skillTag` | Optional controlled tag: `main_idea` \| `detail` \| `inference` \| `vocabulary_in_context` |
| `remediationViewed` | Sticky boolean engagement flag |

The row never stores article text, question text, answer/option text,
explanations, prompts, definitions, notes, or selected text.

### Array storage (SQLite + PostgreSQL from one source)

SQLite's Prisma provider does **not** support scalar lists, so id arrays are
stored as `Json` (`JSONB` in both migrations) rather than `String[]`. This keeps
a single `prisma/base.prisma` source generating both
`prisma/schema.prisma` (SQLite) and `prisma/postgresql/schema.prisma`
(PostgreSQL). The columns only ever hold **string ids**; the repository coerces
them through `toIdArray()` on read, dropping any non-string entries defensively.

### Controlled string values (not enums)

Following the `ArticleDifficultyFeedback.vote` convention, `status`, `source`,
`completionTier`, `generationReasonCode`, and `skipReason` are plain `String`
columns rather than new Prisma enums. This avoids engine-specific `CREATE TYPE`
drift between SQLite and PostgreSQL. The allowed sets and `is*` validators live
in `today-session/types.ts`; the repository calls `assertControlledValue(...)`
to **reject invalid writes before persistence** (fail closed). Reads coerce any
unexpected stored value back to a safe default so a legacy row never crashes a
read.

## Timezone / local-date semantics

`local-date.ts` resolves the local day, aligned with the local-day convention in
[`engagement-analytics.md`](./engagement-analytics.md) (the same
`dateKey(date, tz)` bucketing used for `DailyActivity`).

Timezone fallback chain:

1. `Profile.timezone` (the learner's saved IANA zone), when valid;
2. a request/browser-supplied timezone, when valid;
3. **UTC**, when neither is a valid IANA zone.

Invalid timezone strings are detected with `Intl.DateTimeFormat` and ignored
rather than throwing, so a corrupt profile value degrades gracefully to the next
link in the chain. `resolveLocalDate({ userId, requestTimezone?, now? })`
returns `{ localDate: "YYYY-MM-DD", timezone }`, and the resolved zone is stored
as `timezoneSnapshot` so the day's anchor is auditable after the fact.

## Generation lifecycle

`getOrCreateTodaySession({ userId, localDate?, timezoneSnapshot?, … })` produces
or returns the day's session. It is **idempotent on `(userId, localDate)`**.

1. **Resolve the day** — if `localDate`/`timezoneSnapshot` are not supplied,
   derive them via `resolveLocalDate`.
2. **Return existing** — if a row already exists for `(userId, localDate)`, it is
   returned unchanged. No regeneration, no reshuffling.
3. **Build the plan** (`buildTodayPlan`):
   - **Resume first.** Find the most recent in-progress article that is
     incomplete, between **15–94%** progress, updated within the last **7 days**,
     and still publicly readable (Article Library rules via
     `publicListableArticleWhere`). If found → `source = resume`,
     `generationReasonCode = resume_in_progress`. Backups come from Picks,
     excluding the resume article so a backup never duplicates the primary.
     Resume outranks new Picks **only when recent and not stale** — stale or
     out-of-range progress is excluded and the flow falls through to Picks.
   - **Picks fallback.** Otherwise call `listScoredPicksPage(userId, …)` and take
     the top-ranked article as `primaryArticleId`, the next few as
     `backupArticleIds`. `source = picks`,
     `generationReasonCode = picks_primary`.
   - **No-candidate fallback.** If neither yields a candidate,
     `primaryArticleId = null`, empty backups, `source = none`,
     `generationReasonCode = no_candidate` — a browse/import prompt state.
   - **Target words** are selected for the chosen `primaryArticleId`
     (see below).
4. **Persist** the plan with `createTodaySession`.
5. **Concurrency.** Two first-loads can race the unique constraint. The loser's
   `create` throws Prisma **P2002**; the generator catches it and **re-reads the
   winner's row**, so concurrent loads never create duplicate sessions.

Article ids are **revalidated before display and replacement**: resume uses the
readable where-clause, and backups come from the publicly-listable Picks feed.
Today-specific rules are **not** pushed down into Recommendations — Picks owns
scoring, Today owns orchestration.

## Target saved-word selection

`target-words.ts` (`selectTargetWordIds`) chooses a small, privacy-safe set of
`SavedWord` ids for the day's review. Priority order:

1. **Due/never-reviewed words linked to the primary article** (a word is "due"
   when it has never been reviewed or its `dueAt` has passed);
2. then **oldest-due** words across the whole vocabulary;
3. then **weak/recent** words (lowest ease factor, newest first) to top up.

The default target is **3–5** when enough candidates exist; **zero is valid** —
a Today session never requires target words. Selection is **deterministic** for a
given DB state (stable secondary sort on id), so repeated same-day generation
does not reshuffle an existing session.

Only `SavedWord.id` values and `reviewTargetCount` are stored. The selection
query requests **id and ranking columns only** (`id`, `articleId`, `dueAt`,
`easeFactor`, `createdAt`, `lastReviewedAt`) and **never** `word`,
`explanation`, `example`, or `contextSentence`. Deleted or inaccessible words are
handled gracefully — ids that no longer resolve are simply revalidated away at
read/completion time.

## Completion tiers & integration

Today wires **existing** learning facts into step completion — it is **not** the
source of truth for those facts. The pure tier engine and the marker commands
live in `today-session/completion.ts`; the public functions are re-exported from
the barrel.

### Tiers (best-available)

`completionTier` is a controlled string (`none` | `reading` | `comprehension` |
`full`). The tier is computed from which step timestamps are set, with
"best-available" semantics so a day completes at the best tier it can actually
reach:

| Reading | Comprehension | Word review | Has target words | `completionTier` | Session `status` |
| --- | --- | --- | --- | --- | --- |
| ✗ | – | – | – | `none` | `active` |
| ✓ | ✗ | – | – | `reading` | `active` |
| ✓ | ✓ | ✗ | yes | `comprehension` | `active` (review still pending) |
| ✓ | ✓ | ✓ | yes | `full` | `completed` |
| ✓ | ✓ | – | **no** | `comprehension` | `completed` (best available) |

- `reading` requires `readingCompletedAt`.
- `comprehension` (the "standard" tier) requires reading **plus**
  `comprehensionCompletedAt`.
- `full` requires comprehension **plus** `wordReviewCompletedAt`, and only
  applies when the session has resolvable target words.
- When **no** (resolvable) target words exist, `comprehension` is the best
  available tier and completes the session on its own.
- `completedAt` is set once the best-available tier is reached. Transitions are
  **monotonic** — a recompute never downgrades the tier and never clears
  `completedAt`; a `skipped` session is left untouched (skip is a separate
  lifecycle, kept apart from general activity streaks).

### Completion sources (idempotent, defensively hooked)

Each marker resolves the learner's **current** Today session for their local day
and re-runs the tier engine; all are **idempotent** (an earlier completion
timestamp is never overwritten) and **no-op** when no active session exists or
the action targets a non-primary article, so they never throw into the existing
record path that calls them.

- **Reading** (`markTodayReadingComplete`, `syncTodayReadingFromProgress`,
  `markTodayReadingCompleteManual`). Auto-completes when the **primary** article
  reaches `ReadingProgress.completed` or `percent >= 95`; hooked from the reader
  progress route (covers offline progress sync after the fact). A manual,
  Today-only fallback (`POST /api/today/read-complete`) marks the day's primary
  read **without** reading or mutating `ReadingProgress`. Only the current
  primary article can complete the reading step.
- **Comprehension** (`markTodayComprehensionComplete`,
  `submitTodayComprehension`). Completes from the lightweight Today self-check,
  an existing quiz attempt, or a difficulty-feedback vote on the primary
  article. The self-check accepts one controlled self-rating and, when the
  article has cached `QuizQuestion` rows, zero or one optional MCQ graded
  server-side. Self-rating alone advances `comprehensionCompletedAt`; wrong MCQ
  answers return a remediation deep-link back to the reader without embedding
  content. Actions on non-primary articles are no-ops.
- **Word review** (`markTodayWordReviewComplete`). Recomputed after a flashcard
  grade; completes when enough target saved words have `lastReviewedAt >=`
  the session's `createdAt` (all targets when ≤ 3 resolvable exist, otherwise at
  least 5). Target words deleted since selection drop out of the lookup and are
  skipped gracefully — the effective target count shrinks rather than crashing,
  and an emptied target set falls back to the best-available `comprehension`
  tier.

Completion writes persist **ids / timestamps / flags only** — never article
text, word text, definitions, examples, context sentences, prompts, or notes.

## Cascade & deletion behavior

- **User deletion cascades.** `TodaySession.userId` is a real FK with
  `onDelete: Cascade`; deleting a `User` removes their Today sessions.
- **Article / SavedWord deletion does NOT cascade.** `primaryArticleId`,
  `backupArticleIds`, and `targetSavedWordIds` are plain string ids (not FKs), so
  deleting an `Article` or `SavedWord` leaves the Today row intact. Stale ids are
  revalidated in code before they are shown or acted on.

See [`../security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md)
for the `TodaySession` row in the deletion/retention matrix.

## Privacy & safety

- Stores **anchors and ids only** — never article text, selected text, prompts,
  word definitions, examples, context sentences, private notes, tokens,
  credentials, or PII.
- Persisted JSON columns contain **ids only**; a privacy test asserts the created
  plan and the word-selection query carry no content-bearing fields.
- Controlled values are validated before write; invalid input is rejected, not
  persisted.

## Module layout

```
src/lib/engagement/today-session/
  types.ts        — controlled values, validators, public types (pure)
  local-date.ts   — timezone → YYYY-MM-DD resolution (@server-only)
  repository.ts   — user-scoped get/create/update + view mapping (@server-only)
  target-words.ts — privacy-safe SavedWord id selection (@server-only)
  generator.ts    — getOrCreateTodaySession orchestration (@server-only)
  completion.ts   — tier engine + completion markers (@server-only)
  comprehension.ts — lightweight self-check + controlled feedback row (@server-only)
  skip.ts         — terminal day-skip transition + 1/day limit (@server-only)
  view-model.ts   — privacy-safe Today view model + loader (@server-only)
  index.ts        — stable public barrel
```

Repository helpers always scope by the authenticated `userId` passed by the
caller and never accept a user id from a request body. Server-only modules are
marked with `@server-only` JSDoc (they import Prisma) and are kept out of client
bundles.

## Learner surface (UI, API, routing)

The learner-facing Today surface sits on top of the domain service. It is gated
end-to-end by the `FEATURE_TODAY_SESSION_ENABLED` flag
(`src/lib/runtime-config/feature-flags.ts`, `isTodaySessionFeatureEnabled()`),
which defaults **on**.

### View model (`view-model.ts`)

`buildTodayViewModel()` is a pure function that turns a `TodaySessionView` plus
resolved article display cards into a privacy-safe `TodayViewModel`: session
`status`, `source` (`new` vs `resume`), the primary article display, backups,
target-word review state, per-step states (`reading` / `comprehension` /
`wordReview`), completion tier/progress, a single CTA, and the `isNoCandidate`
state. It also exposes a privacy-safe weak-word re-exposure explanation (#808):
`reviewsSavedWords` (true when the day re-exposes saved words) plus
`savedWordCount` — a flag and COUNT only, so the UI can say "reviews words you
saved" without any word text reaching the payload. `loadTodayViewModel()` is the
server loader: it resolves the learner's
local day, calls `getOrCreateTodaySession`, and hydrates article ids to safe
`ListingArticle` cards via `getReadableArticleById` (revalidating ids against
Article Library access rules). The payload carries **display fields only** — no
article body, word text, definitions, prompts, or notes.

### API routes (`src/app/api/today/`)

All routes return `404` when the feature flag is off and scope every query to
the authenticated session user (never a body-supplied id):

- **`GET /api/today`** — returns the `TodayViewModel` summary for the learner's
  local day. Accepts an optional `timezone` query (validated; over-long input is
  rejected with `400`).
- **`POST /api/today/skip`** — skips today with a controlled `skipReason`
  (`not_interested` \| `too_busy` \| `too_hard` \| `too_easy` \| `other`);
  invalid values are rejected with `400`. Idempotent with a 1-skip/day limit.
- **`POST /api/today/read-complete`** — the pre-existing manual reading fallback
  (unchanged; reused, not duplicated).
- **`GET /api/today/comprehension`** — returns the day's optional comprehension
  MCQ (id + display text/options only, never `correctIndex`) plus completed /
  already-submitted flags. When no cached question exists, the UI degrades to a
  self-rating-only check.
- **`POST /api/today/comprehension`** — submits the controlled self-rating and
  optional MCQ selection. The answer is graded server-side; a wrong answer
  returns a reader deep-link for remediation. The persisted feedback row carries
  ids/enums/booleans only.
- **`POST /api/today/word-review-complete`** — thin idempotent endpoint over the
  same word-review completion hook used by flashcard grading, primarily so the
  offline queue can replay `today.word-review-complete`.
- **`POST /api/today/set-article`** — set a readable article as today's primary.
  See "User-selected primary" below.

### Skip semantics (`skip.ts`)

`skipTodaySession()` is a **terminal day transition**, not a per-article
re-pick: it validates the reason, sets `status = skipped`, appends the dismissed
primary id to `backupArticleIds` (ids only), and surfaces backups for a browse
fallback. It is idempotent and enforces `TODAY_DAILY_SKIP_LIMIT = 1` per local
day (a second skip returns `limitReached`). The daily plan stays immutable —
skipping does not reshuffle or generate a replacement plan. Per-article
skip-and-promote is not modeled by the current schema.

### User-selected primary (v1.1, `set-article.ts`)

`setTodayPrimaryArticle()` lets a learner **override** the generated primary with
a readable article of their own choosing (#805). Unlike skip, this is a **plan
mutation**: it swaps `primaryArticleId`, stamps `source = "user_selected"` (a new
controlled `TODAY_SESSION_SOURCES` value — `source` stays a plain `String`
column, so **no migration**), and **retains the replaced generated id** by
appending it to the stable `backupArticleIds` list (ids only) so the prior pick
is never lost for analytics or the browse fallback. Access is enforced through
the Article Library policy (`getReadableArticleById`): another user's private
article — or a missing id — resolves to nothing and surfaces as **404**
(IDOR-safe, existence is never leaked). Only a `PUBLISHED` article qualifies; one
still `PROCESSING` or `FAILED` is blocked with a clear `not_ready` error
(**409**) so the UI can message it. `ReadingProgress` is **never read, deleted,
or altered** — choosing a new primary cannot fabricate or wipe progress. The
action is idempotent (re-selecting the active user-chosen primary is a no-op),
always scoped to the authenticated user, and emits a metadata-only
`today_article_selected` event.

- **`POST /api/today/set-article`** — body `{ articleId, timezone? }`. Flag-gated
  (404 when off), session-scoped, returns the refreshed `TodayViewModel`. A
  blank/over-long `articleId` is rejected with `400`; inaccessible → `404`;
  processing/failed → `409`.

The affordance is surfaced (only when the flag is on) from the **Reader** header,
the shared **article card** overlay (`ArticleCardView`'s `setTodayEnabled` prop —
used on My Imports and the Today backups), via the reusable
`SetTodayArticleButton` client primitive.

### Page (`src/app/(app)/today/page.tsx`)

A server component gated by the flag (`notFound()` when off) and
`requireOnboardedSession`. It renders the daily plan via `loadTodayViewModel`
and branches across the no-candidate (browse/import `EmptyState`), skipped,
active, and completed states. The interactive workflow
(`_components/TodayWorkflow.tsx`, `"use client"`) drives the read →
comprehension → word-review steps, showing per-step status, completion progress,
a resume-vs-new framing, and the manual mark-read and skip actions (calling the
API routes above). UI is composed only from `src/components/ui/*` primitives and
design tokens (light/dark/mobile, keyboard-accessible).

### Dashboard card (`dashboard/_sections/DashboardTodayCard.tsx`)

A secondary entry point on the dashboard that links to `/today` and shows brief
status. It is rendered only when the flag is on (the dashboard view model loads
`todaySummary` conditionally) and reuses the `Card` primitive without changing
other dashboard logic.

### Default routing (`src/lib/learner-landing.ts`)

`defaultLandingPath(role?)` returns `/today` for learners when the flag is on,
and `/dashboard` otherwise; **admins always land on `/dashboard`**. It drives the
post-sign-in redirect (`signin/page.tsx`, explicit `callbackUrl` still honored),
the already-onboarded redirect (`onboarding/page.tsx`), and the `/welcome` tour
destinations. When the flag is off, landing behavior is unchanged. Auth/session
semantics are untouched — only the default landing target changes.

> **Note — root redirect / middleware:** `middleware.ts` also routes the
> authenticated landing page (`/`) through `defaultLandingPath()`, but the
> repository's `middleware.ts` lives at the project root while the app is under
> `src/`, so Next.js does **not** currently execute it. The learner-landing
> behavior is therefore delivered via the page-level server redirects above
> (which do run) and verified by unit tests. Relocating middleware to
> `src/middleware.ts` (which would also activate centralized route protection)
> is a pre-existing, app-wide change tracked as a separate follow-up.


## Feature flag & rollout

Today Session ships behind a runtime kill switch so it can be disabled without a
code deploy.

### Environment variable

```
FEATURE_TODAY_SESSION_ENABLED="true"   # default — feature is on
```

Set to `"false"`, `"0"`, or `"off"` to disable. Any other value, or absent,
keeps the feature enabled. Parsed by
`src/lib/runtime-config/feature-flags.ts` (`isTodaySessionFeatureEnabled()`),
which follows the same convention as `FEATURE_AI_ENABLED`, `FEATURE_TTS_ENABLED`,
`FEATURE_PUSH_ENABLED`, and `FEATURE_SCRAPER_ENABLED`.

See `docs/platform/runtime-config.md § Feature kill switches` for the full
convention.

### Default state

The flag defaults to **enabled**. No env var change is required to ship the
feature; it is active as soon as the code is deployed.

### Disabled behavior

When `FEATURE_TODAY_SESSION_ENABLED` is set to a falsy value:

| Surface | Behavior when disabled |
| --- | --- |
| `/today` route | Returns HTTP 404 (`notFound()` in the page server component) |
| Dashboard Today card | Hidden — `todaySummary` is not loaded; dashboard layout is unchanged |
| Default learner landing | `/dashboard` (same as before Today Session) |
| Today API routes (`/api/today/*`) | Return a graceful 404/disabled response |
| Learner session/auth flow | Unchanged — only the default landing target changes |

Disabling the flag does **not** delete or invalidate existing `TodaySession`
rows; it only removes the UI and API entry points. Re-enabling restores full
behavior without data loss.

### Rollout notes

- **Staged rollout:** deploy with `FEATURE_TODAY_SESSION_ENABLED="false"` to
  verify infrastructure before opening to learners, then flip to `"true"`.
- **Rollback:** set `FEATURE_TODAY_SESSION_ENABLED="false"` and restart the
  process. No schema migration required.
- The flag is **server-only** — never import `feature-flags.ts` from a Client
  Component.

## Related current docs

- [`profile-preferences.md`](./profile-preferences.md) — reading placement and
  goal-path preference inputs consumed by Today recommendations and copy.
- [`learning-and-mastery.md`](./learning-and-mastery.md) — mastery updates,
  Today comprehension feedback, and privacy-safe coach memory.
- [`../reader/offline-sync.md`](../reader/offline-sync.md) — offline Today
  mutation queue and replay semantics.
- [`reading-series.md`](./reading-series.md) — current `ReadingSeries` /
  `SeriesEnrollment` schema state; not currently consumed by Today generation.
