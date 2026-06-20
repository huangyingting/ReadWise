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

### M7 — Daily-Goal Editing Backend (2026-06-19) ✅ LANDED — committed cb204c5
Extended `parseProfileInput` and both profile API routes to accept and validate `dailyGoal`. No schema changes needed (`Profile.dailyGoal Int @default(2)` existed since M6 migration `20260619080608`).
- **Constants** `DAILY_GOAL_MIN=1`, `DAILY_GOAL_MAX=10`, `DAILY_GOAL_DEFAULT=2` exported from `src/lib/profile.ts`.
- **Validation**: hard-reject non-integer or out-of-`[1,10]`; `null`/`undefined` omitted from return value (preserves existing DB row on upsert — never silently resets).
- **API routes**: `PUT /api/profile` + `POST /api/onboarding` both use conditional spread `...(body.dailyGoal !== undefined ? { dailyGoal: body.dailyGoal } : {})`.
- **Tests**: +9 new tests (profile.test.ts +3: accepts 1/5/10, rejects 0/11/1.5/"5", omits when absent; profile-route.test.ts +6: PUT persists valid goal, rejects min/max, rejects non-integer, omits on absent, preserves other fields). Total: 153/153 pass.

### M9 — Command Palette + Final A11y/Motion QA (2026-06-19) ✅ LANDED — committed dff6c1f
No direct M9 work (Livingston's M4 `GET /api/search` endpoint reused unchanged by the command palette). M9 completed by Saul/Linus/Rusty/Basher. **Redesign roadmap M4–M9 is now fully complete.** All surfaces on Studio design system; 153/153 tests pass; no schema or API changes in M9.

### M10 — Bookmarks & Reading Lists Data Layer (2026-06-19) ✅ SHIPPED — in working tree

Built the full M10 backend: additive schema migration, reading list/bookmark helpers, 6 API route files.

**Migration:** `prisma/migrations/20260619232528_m10_reading_lists/`
- New model `ReadingList` (userId+isDefault, cascade on User, @@index([userId]))
- New model `ReadingListItem` (listId+articleId @@unique, cascade both FK directions, @@index([articleId]))
- Back-references added: `User.readingLists`, `Article.readingListItems`

**Lib (`src/lib/bookmarks.ts`):**
- `getOrCreateDefaultList(userId)` — lazy "Saved" list creation
- `getUserLists(userId)` — all lists with item counts, default first
- `getListWithArticles(listId, userId)` — ownership-checked list + articles via toListingArticle
- `createList` / `renameList` / `deleteList` (refuses to delete default → 409)
- `addToList` / `removeFromList` — both idempotent, ownership-checked
- `toggleBookmark(userId, articleId)` — default-list add/remove, returns `{ok, bookmarked}`
- `getBookmarkedArticleIds(userId, articleIds[])` — batch Set for listings (any list)
- `getArticleListMembership(userId, articleId)` — per-list membership for list-picker popover

**Endpoints (all session-gated, uncached):**
- `GET  /api/lists` → `{lists:[{id,name,isDefault,count}]}`
- `POST /api/lists` body `{name}` → `{list}` 201
- `PATCH  /api/lists/[id]` body `{name}` → `{list}` (rename; 404/401)
- `DELETE /api/lists/[id]` → `{ok}` (404/409 for default/401)
- `POST /api/lists/[id]/items` body `{articleId}` → `{ok}` (idempotent; 404/401)
- `DELETE /api/lists/[id]/items/[articleId]` → `{ok}` (idempotent; 404/401)
- `POST /api/bookmarks/toggle` body `{articleId}` → `{bookmarked:bool}` (404/401)
- `GET  /api/bookmarks/membership?articleId=` → `{lists:[{id,name,isDefault,hasArticle}]}` (for list-picker popover)

**Tests:** 38 new tests (18 lib + 22 route). 191/191 total, 0 regressions.
**Contract note:** `.squad/decisions/inbox/livingston-m10-bookmarks.md`

No direct M9 work (Livingston's M4 `GET /api/search` endpoint reused unchanged by the command palette). M9 completed by Saul/Linus/Rusty/Basher. **Redesign roadmap M4–M9 is now fully complete.** All surfaces on Studio design system; 153/153 tests pass; no schema or API changes in M9.

### M10 — Bookmarks & Reading Lists: LANDED — committed c676921
Rusty APPROVE-WITH-NITS (no IDOR — all endpoints verified ownership-scoped; 6 deferrable nits N1–N6). Basher PASS 57/57 browser checks including full IDOR cross-user verification (all User A vs User B operations return 404). `/api/saved` batch endpoint accepted by Rusty as a valid client-refresh path (session-gated, validated, user-scoped). Key N1 note: `getOrCreateDefaultList` lacks a `@@unique(userId, isDefault=true)` DB guard; race is narrow (first bookmark only) and degrades gracefully — deferred to M11. All 191 tests pass. Coordinator decisions: nav label "Saved", route `/lists`.

### M11 — Highlights & Notes (2026-06-19) ✅ SHIPPED — committed 1e69c01
Delivered M11 backend: additive migration `20260620002627_m11_highlights` (`Highlight` model — `quote`, `startOffset/endOffset Int`, `prefix/suffix String @default("")`, `note String?`, `color String?`, `@@index([userId, articleId])`; cascade User + Article). `src/lib/highlights.ts`: `listHighlights`, `createHighlight` (validates anchor), `updateHighlight` (anchor immutable), `deleteHighlight`, `getHighlightCounts` (batch); `validateAnchor` + `HIGHLIGHT_COLORS` + `HIGHLIGHT_NOTE_MAX = 2_000` exported. IDOR: all helpers include `userId` in WHERE. 4 endpoints all `createHandler` (401 unauth): GET+POST on `/api/reader/[id]/highlights`; PATCH+DELETE on `/api/highlights/[id]`. Documented anchor contract for Linus (plain-text offset selector + prefix/suffix fallback + orphaned strategy). Pre-land fix F3: both route schemas updated to `HIGHLIGHT_NOTE_MAX` (2k not 50k). 28 new tests (6 validateAnchor, 5 lib CRUD, IDOR/400/404/200-201 route paths). 219/219 tests pass.
