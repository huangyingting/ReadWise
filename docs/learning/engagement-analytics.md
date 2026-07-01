---
title: "Engagement analytics, streaks, heatmaps, and reading speed"
category: "Learning"
architecture: "Documents learner-owned engagement read models derived from progress, daily activity, streaks, heatmaps, and reading speed."
design: "Captures current local-day rules, forward-only progress, shield policy, WPM calculations, gamification summary, and privacy boundaries."
plan: "Update when progress writes, DailyActivity, streak/shield logic, heatmap, reading speed, or gamification summary behavior change."
updated: "2026-07-01"
rename: "none"
---

# Engagement analytics, streaks, heatmaps, and reading speed

Engagement analytics are learner-facing signals derived from user-owned domain
tables. They are not the append-only product analytics stream described in
[`../analytics/product-analytics.md`](../analytics/product-analytics.md).

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Progress writes | `src/lib/engagement/progress.ts` | Forward-only reading progress and completion state. |
| Daily activity | `src/lib/engagement/activity.ts` | Local-day distinct article counts, shield earn/use side effects. |
| Streak summaries | `src/lib/engagement/streak.ts` | Current/longest streak, last-seven-days dots, shield count. |
| Heatmap | `src/lib/engagement/heatmap.ts`, `src/lib/engagement/heatmap-repo.ts` | 365-cell activity grid and database read model. |
| Reading speed | `src/lib/engagement/reading-speed.ts`, `src/lib/engagement/reading-speed-repo.ts` | Pure WPM computation and ArticleMastery-backed trend reads. |

## Progress contract

`saveProgress(userId, articleId, rawPercent)` clamps percent to `0..100` and
writes progress with two invariants:

- percent is forward-only and never decreases,
- completion is sticky after the completion threshold (`95%`) is reached.

The write path is race-safe for multi-tab/offline replay scenarios. Concurrent
first writes retry on unique-constraint conflicts; updates use a guarded
`updateMany` so a lower incoming percent cannot overwrite a higher stored value.

Daily activity recording is a best-effort side effect. If it fails, progress
still succeeds and the error is logged.

## Local-day activity

`recordReadingActivity(...)` recomputes the number of distinct articles advanced
on the user's current local calendar day and upserts `DailyActivity`.

Day-boundary rules:

- use the user's IANA timezone from `Profile.timezone`, or the timezone supplied
  by the client on the progress request, defaulting to UTC;
- store `DailyActivity.date` as UTC midnight of the local calendar date;
- bucket `ReadingProgress.updatedAt` through `dateKey(updatedAt, tz)`, not a
  fixed UTC window.

This avoids truncating activity for readers whose local day straddles UTC
midnight.

## Heatmap

`buildHeatmapCells(activityMap, todayStr?)` returns a fully populated 365-cell
grid: 52 weeks plus today. Sparse days are filled with zeroes.

Heat levels are deterministic:

| Articles read | Level |
| --- | ---: |
| `0` | 0 |
| `1` | 1 |
| `2-3` | 2 |
| `4-5` | 3 |
| `6+` | 4 |

## Streaks and shields

An active day is any `DailyActivity` row with `articlesRead > 0`.

`getStreakSummary(userId)` returns:

- current streak,
- longest streak,
- daily goal,
- today's progress,
- last seven days,
- available streak shields.

Current streak anchors on today when today is active, otherwise yesterday when
yesterday is active. This lets users keep an in-progress streak visible before
they read today.

Shield policy:

- earn one shield after seven consecutive active days,
- hold at most one shield,
- spend one shield to fill exactly one missed day when two days ago was active,
  yesterday was missed, and today becomes active.

Shield updates and the daily activity upsert run transactionally so the visible
count and the stored activity row do not drift.

## Gamification summary route

`GET /api/gamification/summary` combines `getStreakSummary(userId)` with
`getReviewSummary(userId)` so dashboard widgets can render current streak,
longest streak, daily goal, today's progress, last-seven-day activity, shield
count, and SRS due-count metadata in one request. The endpoint returns counts
and booleans only; it never returns reviewed words, definitions, article text,
quiz answers, or private study content.

The complete widget contract is documented in [`gamification.md`](./gamification.md).

## Reading speed

Reading speed uses `ArticleMastery.timeSpentMs` plus article `wordCount`.

Pure rules in `reading-speed.ts`:

- active time is clamped to one hour per article,
- fewer than five seconds of active time is ignored,
- WPM is clamped to the plausible range `50..600`,
- average WPM uses all valid recent records,
- recent WPM uses the latest valid sessions.

The repository reads at most the latest 50 eligible mastery rows and returns
`null` values when there is not enough data.

## Privacy and deletion

Engagement rows are user-owned and cascade with the user. They should not be
copied into product analytics properties, logs, security events, or audit
metadata except as aggregate counts.

## Tests

Relevant tests include `tests/activity.test.ts`, `tests/aggregation.test.ts`,
`tests/article-mastery.test.ts`, `tests/offline-sync.test.ts`, and focused
engagement/progress tests.
