# Curated reading series

Curated reading series are a lightweight schema foundation for ordered article
collections and per-user enrollment progress. They do **not** currently have a
learner-facing API, admin UI, or Today generator integration in `src/`; the
models are inert unless a trusted script, seed, migration, or future feature
code writes and reads them.

This document describes the current durable data contract only.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Schema | `prisma/base.prisma` → generated SQLite/PostgreSQL schemas | `ReadingSeries` and `SeriesEnrollment` models. |
| Account lifecycle | `src/lib/account-lifecycle/account-commands.ts` | Does not currently include `SeriesEnrollment` in `exportUserData`. |
| Today generator | `src/lib/engagement/today-session/generator.ts` | Does not currently read `SeriesEnrollment`; Today uses resume-first then Picks fallback. |

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

- No `src/app/api/series/*` routes exist.
- No learner or admin UI currently lists, enrolls in, pauses, or completes
  series.
- Today Session does not currently prefer series articles; the active generator
  path is still resume-first, then scored Picks, then no-candidate fallback.
- `exportUserData` does not currently include `SeriesEnrollment` rows.

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