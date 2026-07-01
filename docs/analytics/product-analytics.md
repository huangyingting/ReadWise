---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the append-only product analytics event stream, retention helpers, and privacy boundaries. Captures current event schemas, sanitizer behavior, dashboard/export rules, and metadata-only constraints."
---

# Product analytics (Epic RW-E010)

ReadWise records a lightweight, append-only stream of **product analytics
events** so we can measure funnels, activation, retention, and feature usage
without coupling dashboards to a dozen domain tables. This document is the
canonical description of the event schema, its version, and the privacy /
retention rules that govern it.

> **Schema version: `1`** (see `ANALYTICS_SCHEMA_VERSION` in
> `src/lib/analytics/events/catalog.ts`). Every stored event stamps `properties._v` with the
> version it was written under.

## Subsystem ownership boundary

Analytics owns the **product event stream** only:

| Owned by Analytics | Module |
| --- | --- |
| Event type catalog and schema version | `src/lib/analytics/events/catalog.ts` |
| Event sanitizer (sensitive-key drop + value coercion) | `src/lib/analytics/events/sanitize.ts` |
| Event writer (`recordEvent`) | `src/lib/analytics/events/writer.ts` |
| Retention + per-user erasure (`pruneOldEvents`, `deleteEventsForUser`) | `src/lib/analytics/events/retention.ts` |
| Funnel / activation / reading-completion / study-conversion / feature-usage queries and export contract | `src/lib/analytics/queries/` |

Analytics is **not** a catch-all for every aggregation in the product. Several
modules that ship under `src/lib/analytics/` are **domain read models** — they
query source-domain tables directly and are composed by their respective
dashboards. See [`domain-reporting.md`](./domain-reporting.md) for their
ownership and privacy rules.

| Domain read model | Owned by | Module |
| --- | --- | --- |
| Learner activity analytics (progress, vocab, quizzes, streaks) | Learning | `src/lib/analytics/learner.ts` |
| Classroom / tenant analytics and access-control rules | Access & Tenancy | `src/lib/analytics/tenant.ts` |
| Admin library statistics (article counts, member activity, top tags) | Article Library / Admin | `src/lib/analytics/admin.ts` |
| AI usage ledger (cost / volume / latency / fallback) | AI | `src/lib/ai-usage-summary.ts` |
| Job / content-processing health | Operations | `src/lib/processing/state.ts` |

## Why a separate event stream?

The domain tables (`ReadingProgress`, `SavedWord`, `QuizAttempt`, …) are the
source of truth for a user's data. The analytics stream is a **complementary,
denormalized log of product-significant moments** optimized for aggregation
(funnels, cohorts, feature usage). It is intentionally:

- **Metadata-only** — never article text, selected text, prompts, definitions,
  or PII.
- **Best-effort** — a write failure must never break the user action that
  emitted it.
- **Non-cascading** — `userId` / `articleId` are plain string identifiers (not
  foreign keys), so an event survives user/article deletion. Privacy is enforced
  by an explicit retention window + per-user purge, not by DB cascades.

Learner-facing progress analytics, mastery scores, streaks, heatmaps and
adaptive level recommendations are documented separately in
[`learning-and-mastery.md`](../learning/learning-and-mastery.md). Those are derived from
user-owned domain tables and are not part of this append-only product-event
stream.

## The `AnalyticsEvent` model

| Field         | Type       | Notes                                                            |
| ------------- | ---------- | ---------------------------------------------------------------- |
| `id`          | string     | cuid primary key                                                 |
| `type`        | string     | One of the canonical event types below                           |
| `userId`      | string?    | Plain id (not an FK); defaults from the request context          |
| `anonymousId` | string?    | Pre-auth / device id when there is no user                       |
| `articleId`   | string?    | Plain id (not an FK)                                              |
| `sessionId`   | string?    | Optional app/session correlation id                              |
| `properties`  | Json       | Small, flat, non-sensitive metadata; stamped with `_v`           |
| `occurredAt`  | DateTime   | When the event happened (defaults to now)                        |
| `createdAt`   | DateTime   | When the row was written                                         |

Indexes: `(type, occurredAt)`, `(userId, occurredAt)`, `(occurredAt)` — the
shapes the funnel / retention / prune queries use.

## Canonical event types (v1)

Defined in `ANALYTICS_EVENT_TYPES` (`src/lib/analytics/events/catalog.ts`):

| Type                  | Emitted when                                  | Typical metadata                         |
| --------------------- | --------------------------------------------- | ---------------------------------------- |
| `onboarding_start`    | A user begins onboarding                      | —                                        |
| `onboarding_complete` | Onboarding profile is finished                | `{ level }`                              |
| `article_view`        | An article reader page is opened              | `{ category, difficulty }`               |
| `progress_complete`   | A reader reaches the completion threshold     | `{ percent }`                            |
| `lookup`              | A dictionary word lookup runs                 | `{ found }`                              |
| `save_word`           | A word is saved to the study list             | `{ hasArticle }`                         |
| `quiz_start`          | A comprehension quiz is started               | —                                        |
| `quiz_complete`       | A quiz attempt is submitted                   | `{ scorePct, correctCount, total }`      |
| `translation_use`     | A translation is requested                    | `{ lang }`                               |
| `tutor_use`           | The AI tutor is used                          | —                                        |
| `offline_save`        | An article is saved for offline reading       | —                                        |
| `import`              | A user imports an article                     | `{ via }`                                |
| `study_review`        | A study/flashcard review is graded            | `{ grade }`                              |
| `today_session_generated`     | A Today daily plan is first created for a local day | `{ source, reasonCode, hasPrimary, backupCount, targetWordCount, reviewTargetCount }` |
| `today_no_candidate`          | A no-candidate Today day shows the browse/import prompt | `{ source, reasonCode }`        |
| `today_session_viewed`        | The learner views Today (page render or summary fetch) | `{ status, source, tier, hasPrimary, isNoCandidate, skipped }` |
| `today_reading_complete`      | The Today reading step first completes        | `{ method, tier, hasTargetWords }`       |
| `today_comprehension_complete`| The Today comprehension step first completes  | `{ tier }`                               |
| `today_word_review_complete`  | The Today word-review step first completes    | `{ tier, targetCount }`                  |
| `today_session_complete`      | The whole Today session first reaches `completed` | `{ tier, source, hadTargetWords }`   |
| `today_skip`                  | The learner skips Today with a controlled reason | `{ reasonCode, limitReached, browseFallback, backupCount }` |
| `today_article_selected`      | The learner sets a readable article as today's primary (v1.1) | `{ source, replacedGenerated, backupCount }` |

These are the funnel/retention-significant moments. The list is deliberately
small; add a new type (and bump the version if semantics change) only when a new
product-significant moment needs measuring.

### Funnel definition

The default conversion funnel (in `analytics-queries.ts`) is a strict
descending funnel of **distinct users** who performed each stage *and* every
prior stage:

```
onboarding_complete → article_view → save_word → quiz_complete → study_review
```

Activation, reading-completion, and study-conversion are computed as
distinct-user ratios between adjacent moments.

## `properties` rules (metadata only)

`recordEvent` runs every payload through `sanitizeEventProperties`, which:

1. **Drops sensitive keys** — anything matching the sensitive-key regex (e.g.
   `text`, `content`, `word`, `selection`, `translation`, `prompt`, `email`,
   `token`, `secret`, `url`, …) is removed entirely. This is a backstop so an
   accidental `{ text: article.body }` never lands in the stream.
2. **Coerces values to safe primitives** — strings are truncated (≤200 chars),
   numbers must be finite, arrays are capped; nested objects/functions are
   dropped (properties are intentionally flat).
3. **Caps the key count** (≤25) and **stamps `_v`** with the schema version.

> Callers must still treat `properties` as metadata. Never pass free text,
> selected passages, definitions, or PII — even though the sanitizer would drop
> most of it, the contract is metadata-only.

## Emit points

`recordEvent` is wired into a representative subset of user actions. It is
best-effort and non-blocking, so it never changes the outcome of the action:

| Event                 | Call site                                                     |
| --------------------- | ------------------------------------------------------------ |
| `onboarding_complete` | `POST /api/onboarding`                                       |
| `article_view`        | reader page `src/app/(app)/reader/[id]/page.tsx`             |
| `progress_complete`   | `POST /api/reader/[id]/progress` (when completion crossed)   |
| `lookup`              | `POST /api/dictionary`                                       |
| `save_word`           | `POST /api/vocabulary/save`                                  |
| `quiz_complete`       | `POST /api/reader/[id]/quiz/attempt`                         |
| `import`              | `POST /api/articles/import` (url + text paths)              |
| `study_review`        | `POST /api/study/flashcards/grade`                           |
| `today_session_generated` / `today_no_candidate` | `getOrCreateTodaySession` (Today generator, on first create) |
| `today_session_viewed` | `loadTodayViewModel` (the `/today` page + `GET /api/today`)  |
| `today_reading_complete` | `markTodayReadingComplete` (progress sync) + `markTodayReadingCompleteManual` (`POST /api/today/read-complete`) |
| `today_comprehension_complete` | `markTodayComprehensionComplete` (quiz / difficulty signal) |
| `today_word_review_complete` / `today_session_complete` | `recomputeTodayCompletion` (Today completion engine, on first transition) |
| `today_skip`          | `skipTodaySession` (`POST /api/today/skip`, on actual skip)  |
| `today_article_selected` | `setTodayPrimaryArticle` (`POST /api/today/set-article`, on a user-selected override) |

Other types (`onboarding_start`, `quiz_start`, `translation_use`, `tutor_use`,
`offline_save`) are part of the v1 vocabulary and can be wired at their call
sites without a schema change.

### Today Session funnel (#802)

The Today events above are metadata-only and let the Today daily-reading funnel
be computed without touching any content column:

- **Article completion rate** — `today_session_complete` (with `tier`) over
  `today_session_generated` for the day.
- **Time to completion** — `today_session_generated`/`today_session_viewed` →
  `today_reading_complete` / `today_session_complete` timestamps.
- **Skip rate** — `today_skip` over `today_session_generated`.
- **Next-day return** — distinct users with a `today_session_viewed` on
  consecutive local days.

The Today emit helpers live in
`src/lib/engagement/today-session/analytics.ts`; their payloads are restricted
to controlled enums (`source`, `reasonCode`, completion `tier`, reading
`method`, lifecycle `status`), small counts, and booleans — never article/word
content, definitions, notes, prompts, or PII.

## Privacy & retention

- **No sensitive content** is ever stored (enforced by the sanitizer + the
  metadata-only contract).
- **Retention window.** Events older than `ANALYTICS_RETENTION_DAYS` (default
  **400 days**, see `analyticsRetentionDays()` in
  `src/lib/runtime-config/analytics.ts`) are
  prunable via `pruneOldEvents(olderThanDays?)`. Run it from a scheduled job/CLI.
- **Per-user erasure.** Because events do not cascade with the user, call
  `deleteEventsForUser(userId)` when erasing a user's data (GDPR / account
  deletion) to remove their analytics events explicitly.
- **Enablement.** Ingestion is gated by `analyticsEnabled()` — on by default in
  dev/prod, **off under `NODE_ENV=test`** unless `ANALYTICS_ENABLED=1`, so unit
  tests don't write rows unless they opt in.

## Querying & dashboards

- `src/lib/analytics/queries/` aggregates events into the funnel / activation
  / reading-completion / study-conversion / feature-usage overview and weekly
  retention cohorts, with time-range (`days`) and segment (`level`, `topic`)
  filters. Segments resolve matching `userId`s from `Profile` (topic interests
  are stored as a JSON string array, filtered in TS).
- `/admin/analytics` (gated `analytics.view`) renders these views with
  time-range + segment controls and CSV/JSON export
  (`GET /api/admin/analytics/export`).
- `/admin/analytics/ai` (gated `analytics.view`) renders AI cost / volume /
  latency / fallback dashboards (from the `AiInvocation` ledger) and content-ops
  health (from `ArticleProcessingStep` + the job queue) — see
  `src/lib/ai-usage-summary.ts` and `src/lib/processing/state.ts`.
