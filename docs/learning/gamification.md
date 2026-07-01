---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents the Learning/Engagement-owned gamification read model and its relationship to DailyActivity, SRS due counts, and dashboard UI. GET /api/gamification/summary combines streak stats, daily-goal progress, last-seven-day activity, shield count, and due flashcards without duplicating private content."
---

# Gamification summary, streaks, and dashboard widgets

Gamification in ReadWise is lightweight and learning-aligned. It surfaces daily
reading momentum, streak continuity, and due review pressure without introducing
badges or reward tables that duplicate the learning source of truth.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Summary route | `src/app/api/gamification/summary/route.ts` | Single authenticated endpoint for dashboard gamification widgets. |
| Streaks | `src/lib/engagement/streak.ts` | Current/longest streak, daily goal, last seven days, shield count. |
| Daily activity | `src/lib/engagement/activity.ts` | Local-day distinct article counts and shield earn/spend side effects. |
| Flashcard due count | `src/lib/learning/flashcards.ts` | SRS due-count summary for study prompt widgets. |
| Dashboard UI | `src/app/(app)/dashboard/page.tsx`, dashboard widgets/components | Reads summary data alongside Today/current-reading blocks. |
| Tests | `tests/gamification.test.ts`, `tests/activity.test.ts`, streak/heatmap tests | Route and pure-rule coverage. |

## API contract

`GET /api/gamification/summary` requires an authenticated session and returns:

| Field | Meaning |
| --- | --- |
| `currentStreak` | Consecutive active days, anchored on today when active or yesterday when today is not active yet. |
| `longestStreak` | All-time longest streak from `DailyActivity`. |
| `dailyGoal` | Articles-per-day target from `Profile.dailyGoal` (default `2`). |
| `todayProgress` | Distinct articles progressed today in the learner's local day. |
| `last7Days` | Seven `{ date: YYYY-MM-DD, active: boolean }` entries for compact widgets. |
| `dueCount` | Flashcards due now, from the SRS queue. |

The route intentionally combines Engagement and Learning read models so the
dashboard does not make multiple round trips for small widget data.

## Streak rules

An active day is a `DailyActivity` row with `articlesRead > 0`.

Current streak anchors on:

1. today, when today is active;
2. otherwise yesterday, when yesterday is active;
3. otherwise zero.

This keeps an in-progress streak visible before a learner reads today, without
pretending today is already complete.

## Shield rules

Streak shields are stored on `Profile.streakShields` and updated as side effects
of daily activity recording:

- earn one shield after seven consecutive active days;
- hold at most one shield;
- spend one shield to bridge exactly one missed day when two days ago was active,
  yesterday was missed, and today becomes active.

The daily activity upsert and shield update run transactionally so the visible
shield count and stored activity row do not drift.

## Due review pressure

`dueCount` comes from `getReviewSummary(userId)`. A card is due when:

- it has never been reviewed (`dueAt = null`), or
- `dueAt <= now`.

The gamification endpoint returns only the count. It never returns words,
definitions, examples, context sentences, article IDs, or study history details.

## Relationship to mastery widgets

Mastery widgets should read from the Learning source of truth:

- word-level familiarity/confidence from `WordMastery`;
- article comprehension from `ArticleMastery`;
- skill confidence from `SkillMastery`;
- Study Plan summary from `generateStudyPlan`.

Do not create separate gamification tables for mastery values. Dashboard widgets
may visualize these signals, but Learning remains the owner.

## Privacy and deletion

Gamification data is derived from user-owned domain rows and aggregate counts.
Do not copy daily activity, reviewed words, article titles, definitions, or quiz
answers into product analytics event properties. User deletion cascades profile,
daily activity, saved words, mastery rows, and review state.

## Related docs

- [`engagement-analytics.md`](./engagement-analytics.md) — local-day activity, heatmap, reading speed, and streak formulas.
- [`study-plan.md`](./study-plan.md) — due flashcards and study recommendations.
- [`learning-and-mastery.md`](./learning-and-mastery.md) — mastery formulas and durable learning rows.
- [`../analytics/product-analytics.md`](../analytics/product-analytics.md) — separate append-only event stream.
