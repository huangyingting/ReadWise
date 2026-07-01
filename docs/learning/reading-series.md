---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents ReadingSeries and SeriesEnrollment data model, learner series browser/API, and Today soft-candidate integration. Captures current public-series listing, idempotent enroll/unenroll commands, access-checked article resolution, progress advancement, and remaining gaps."
---

# Curated reading series

Curated reading series are ordered article paths that learners can browse,
enroll in, and progress through over time. The current implementation includes a
learner-facing `/series` page, public-series listing API, enroll/unenroll API,
and a Today Session soft-candidate integration. Admin CRUD for creating/editing
series is still out of scope; rows are currently curated by trusted seeds,
scripts, or direct operational tooling.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Schema | `prisma/base.prisma` → generated SQLite/PostgreSQL schemas | `ReadingSeries` and `SeriesEnrollment` models. |
| Series service | `src/lib/engagement/series.ts` | Lists public active series, enrolls/unenrolls, resolves the next access-checked series article, advances progress. |
| Learner page | `src/app/(app)/series/page.tsx`, `SeriesEnrollButton.tsx` | Displays public active series cards and enrollment controls. |
| API | `GET /api/series`, `POST|DELETE /api/series/[id]/enroll` | Authenticated public-series list and idempotent enrollment commands. |
| Today generator | `src/lib/engagement/today-session/generator.ts` | Resolves the next active series article as an extra Picks candidate. |
| Today completion | `src/lib/engagement/today-session/completion.ts` | Best-effort, idempotent series advancement after Today reading completion. |
| Account lifecycle | `src/lib/account-lifecycle/account-commands.ts` | Does not currently include `SeriesEnrollment` in `exportUserData` (follow-up). |

## Data model

### `ReadingSeries`

`ReadingSeries` stores the curator-defined collection metadata:

- `slug`, `title`, optional `description`;
- optional `targetLevelMin` / `targetLevelMax` CEFR strings;
- optional topic string;
- `articleIds` as JSON string ids;
- controlled `status` string (`active` / `archived` by convention);
- `public` boolean visibility flag.

`articleIds` are plain ids, not foreign keys. Deleting an article does not
cascade into a series row, and a series row alone does not grant article access.
Any consumer must resolve article ids through the Article Library access policy
before display.

### `SeriesEnrollment`

`SeriesEnrollment` stores one user's position in a series:

- `userId` FK with `onDelete: Cascade`;
- `seriesId` FK with `onDelete: Cascade`;
- `nextIndex` as the next article position;
- controlled `status` string (`active`, `paused`, or `completed` by
  convention);
- `startedAt` / `completedAt` and timestamps.

The unique key `@@unique([userId, seriesId])` keeps one enrollment per user and
series. User deletion removes enrollments automatically.

## Current runtime behavior

### Learner series browser

`/series` requires an onboarded session and renders cards for rows where
`ReadingSeries.status = "active"` and `public = true`. Each card displays
metadata only: title, optional description/topic/level range, article count, and
the caller's enrollment summary. Article ids and article content are not exposed
by the list API.

`GET /api/series` returns the same authenticated learner view as the page: public
active series with the caller's enrollment state attached.

### Enroll and unenroll

`POST /api/series/[id]/enroll` enrolls the authenticated learner in a public,
active series. It is idempotent: re-enrolling reactivates an existing enrollment
and preserves `nextIndex`. Missing, archived, or non-public series return 404 so
existence is not leaked beyond the public set.

`DELETE /api/series/[id]/enroll` removes the learner's enrollment row. It is
idempotent for already-unenrolled users but still returns 404 for a missing or
non-public series.

### Today soft candidate

Today generation remains resume-first. When no resume article wins, the series
resolver can provide the learner's next access-checked active series article as
an extra candidate to `listScoredPicksPage`. Picks still performs scoring and
visibility filtering; a series article is a soft candidate, not a hard override.

`resolveNextSeriesArticle(userId)` revalidates each stored article id through
the Article Library access policy. Inaccessible/deleted ids are skipped and
`nextIndex` is advanced past them. If no accessible article remains, the
enrollment is marked `completed`.

### Progress advancement

When Today marks its current primary article read, completion code calls
`advanceSeriesOnArticleRead` best-effort. Advancement is monotonic and
idempotent: it advances only when the completed article is the learner's current
resolved series article, and it never double-advances on replay.

### Current gaps

- There is no admin CRUD UI/API for creating, editing, ordering, publishing, or
  archiving series.
- There is no pause/resume UI even though `SeriesEnrollment.status` allows
  `paused`.
- `exportUserData` does not currently include `SeriesEnrollment` rows.
- Series completion is driven by Today reading completion; there is no separate
  manual series-progress API.

## Privacy and access rules

- Series metadata is operational/public catalogue data when `public = true`;
  enrollment rows are personal user data.
- Neither model stores article text, selected text, prompts, definitions, notes,
  or learner free text.
- Article ids in `ReadingSeries.articleIds` must be revalidated through the
  Article Library before use; private or inaccessible articles must not be
  displayed just because their id appears in the JSON array.
- Enrollment status and `nextIndex` are metadata only and are safe for aggregate
  analytics, but user-scoped rows should still be treated as personal data.

## Related docs

- [`today-session.md`](./today-session.md) — current daily plan generation path.
- [`../content/article-library.md`](../content/article-library.md) — article
  visibility and access policy.
- [`../security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md)
  — retention/export classification for `ReadingSeries` and `SeriesEnrollment`.