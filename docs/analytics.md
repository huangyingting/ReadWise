# Product analytics (Epic RW-E010)

ReadWise records a lightweight, append-only stream of **product analytics
events** so we can measure funnels, activation, retention, and feature usage
without coupling dashboards to a dozen domain tables. This document is the
canonical description of the event schema, its version, and the privacy /
retention rules that govern it.

> **Schema version: `1`** (see `ANALYTICS_SCHEMA_VERSION` in
> `src/lib/analytics.ts`). Every stored event stamps `properties._v` with the
> version it was written under.

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

Defined in `ANALYTICS_EVENT_TYPES` (`src/lib/analytics.ts`):

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

Other types (`onboarding_start`, `quiz_start`, `translation_use`, `tutor_use`,
`offline_save`) are part of the v1 vocabulary and can be wired at their call
sites without a schema change.

## Privacy & retention

- **No sensitive content** is ever stored (enforced by the sanitizer + the
  metadata-only contract).
- **Retention window.** Events older than `ANALYTICS_RETENTION_DAYS` (default
  **400 days**, see `analyticsRetentionDays()` in `src/lib/config.ts`) are
  prunable via `pruneOldEvents(olderThanDays?)`. Run it from a scheduled job/CLI.
- **Per-user erasure.** Because events do not cascade with the user, call
  `deleteEventsForUser(userId)` when erasing a user's data (GDPR / account
  deletion) to remove their analytics events explicitly.
- **Enablement.** Ingestion is gated by `analyticsEnabled()` — on by default in
  dev/prod, **off under `NODE_ENV=test`** unless `ANALYTICS_ENABLED=1`, so unit
  tests don't write rows unless they opt in.

## Querying & dashboards

- `src/lib/analytics-queries.ts` aggregates events into the funnel / activation
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
  `src/lib/admin-ai-ops.ts`.
