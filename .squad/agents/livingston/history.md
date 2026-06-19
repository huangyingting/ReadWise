# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

## 2026-06-19 — Redesign roadmap landed
A full redesign roadmap (8 milestones) was produced by Rusty. Livingston is engaged in:
- **M4 (Browse & Discovery):** implement the global article search API endpoint.
- **M6 (Dashboard & Study):** backend support for reading streaks/daily goal and flashcard review over the existing `SavedWord` model.
No active work yet — standby until M1 (design system) and M2 (app shell) are complete.

### M6 — Dashboard & Study Gamification Data Layer (2026-06-19) ✅ SHIPPED — in working tree
Built the full M6 backend: additive schema migration, SM-2 SRS engine, activity/streak tracking, flashcard helpers, and 3 new API endpoints.

**Migration:** `prisma/migrations/20260619080608_m6_gamification/`
- New model `DailyActivity` (userId+date unique, tracks articlesRead per UTC calendar day, cascade on User)
- `SavedWord` +5 SRS columns: `dueAt?`, `intervalDays` (default 0), `easeFactor` (default 2.5), `repetitions` (default 0), `lastReviewedAt?`
- `Profile` + `dailyGoal Int @default(2)`

**Libs:**
- `src/lib/srs.ts`: pure SM-2 engine. Grade mapping: again=reset(EF-0.2,interval=1), hard=q3, good=q4, easy=q5. EF floor 1.3. Hard caps interval at 0.6× of normal.
- `src/lib/activity.ts`: `recordReadingActivity` (recomputes distinct articles from ReadingProgress.updatedAt today, upserts DailyActivity — idempotent); `getStreakSummary` (currentStreak anchors today or yesterday, longestStreak, last7Days dot-row, dailyGoal from Profile).
- `src/lib/flashcards.ts`: `getDueFlashcards` (dueAt≤now OR null, nulls first = new cards first), `gradeFlashcard` (applies SM-2, persists schedule), `getReviewSummary` (dueCount + totalSaved).
- `src/lib/progress.ts` modified: `saveProgress` now calls `recordReadingActivity` as a try/catch side-effect on both update and create paths — forward-only behavior unchanged.

**Endpoints (all session-gated, uncached):**
- `GET /api/gamification/summary` → `{currentStreak, longestStreak, dailyGoal, todayProgress, last7Days, dueCount}`
- `GET /api/study/flashcards` → `{cards:{id,word,explanation,example}[], dueCount}`
- `POST /api/study/flashcards/grade` body `{savedWordId, grade}` → `{dueAt, dueCount}` (400/401/404)

**Tests:** 40 new tests across srs.test.ts, activity.test.ts, gamification.test.ts. 144/144 total, 0 regressions.

**Contract note:** `.squad/decisions/inbox/livingston-m6-data.md`

### M6 — Dashboard & Study Gamification (2026-06-19) ✅ LANDED — committed 1beea38
Pre-land fix **F1** applied: corrected `srs.ts` line 42 doc-comment from "1.2× interval multiplier cap" to "60% (0.6×) interval cap" — constant was already correct, comment-only change. Rusty APPROVE-WITH-NITS (F1 + F2 both resolved pre-land); Basher PASS (87 checks). All 144 tests pass, 0 regressions. SM-2 note for future: implementation uses post-update EF as the interval multiplier at rep≥2 (most SM-2 implementations do this); max deviation is ~1 day/cycle, not a correctness bug. `recordReadingActivity` idempotency relies on recount-and-upsert from `ReadingProgress` (not incrementing), ensuring the count is always accurate regardless of how many times `saveProgress` is called for the same article in a day.
