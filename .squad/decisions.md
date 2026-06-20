# Squad Decisions

## Active Decisions

### DECIDED — Design Direction: B "Studio"
_Chosen by Yingting · 2026-06-19_
**Direction B "Studio" is LOCKED** for the redesign — modern learning-app aesthetic: vivid indigo/violet primary (+ teal/amber accents), Inter/Geist via `next/font`, soft elevated cards, Lucide icons, light + dark themes. Touchstones: Linear / Duolingo / Vercel. All design-system and UI work follows this direction.
Alternatives not chosen: A "Broadsheet" (editorial/serif), C "Focus" (minimal/monochrome).

### ACCEPTED Roadmap (M4–M9) — Migration-First
_Proposed by Rusty · Accepted by Yingting Huang · 2026-06-19_
**Rule: additive migrations only** for all net-new features (no edits to existing columns/migrations). Sequencing: migration-first (clean base, then gamification / net-new on top). Supersedes the earlier M4–M8 sketch.

| # | Milestone | Owners | Effort | Status |
|---|---|---|---|---|
| **M4** | Listings & Discovery — shared card → M1 primitives; skeletons; empty states; continue-reading rail; global search (net-new) | Saul (spec), Linus (build), Livingston (search), Basher (verify) | M | ✅ COMPLETE 7e554c9 |
| **M5** | Reader redesign — layout, font/theme controls, AI tools as sticky tabbed panel, audio mini-player | Saul (spec), Linus (build), Rusty (review), Basher (verify) | L | ✅ COMPLETE f199596 |
| **M6** | Dashboard & Study — reading streaks/daily goal, flashcard SRS over existing `SavedWord` | Livingston (data), Linus (UI), Saul (spec) | L | ✅ COMPLETE 1beea38 |
| **M7** | Onboarding, Auth & Settings polish + daily-goal editing | Saul (spec), Livingston (backend), Linus (build), Rusty (review), Basher (verify) | S–M | ✅ COMPLETE cb204c5 |
| **M8** | Admin polish — design system to `/admin`; extract shared `ConfirmAction` | Linus (build), Saul (light spec) | M | ✅ COMPLETE a631aa9 |
| **M9** | Motion, a11y, responsive QA + ⌘K command palette (reuses M4 search endpoint). Closes M1/M2 nits N2/N3/N4. | Basher (lead QA), Linus, Livingston | M | ✅ COMPLETE dff6c1f |

M4 unblocks M5–M9. Rich-features menu (quick wins + bigger bets) was documented in the accepted roadmap proposal; key greenlit items captured in "Net-New Features Greenlit" above.

### Design Token Foundation (direction-agnostic, ready to implement)
_Proposed by Saul · 2026-06-19_
CSS custom properties on `:root` + `[data-theme="dark"]` + `@media (prefers-color-scheme)`. Semantic color tokens (bg/surface/border/text/primary/accent/success/warning/danger/focus-ring); 1.20 minor-third type scale (`--text-xs` → `--text-4xl`); 4px-base spacing scale (`--space-1..12`); radii (`--radius-sm/md/lg/xl/full`); elevation/shadow (`--shadow-sm/md/lg/xl`); motion durations + easings wrapped in `prefers-reduced-motion`. Fonts via `next/font`.

### Frontend Inventory — Key Refactor Targets
_Proposed by Linus · 2026-06-19_
Current state: 957-line `globals.css`, 6 CSS vars, dark-only, system font, no global nav. High-priority consolidation targets:
1. Extract `Button`, `Input`, `Select`, `Card`, `Badge/Pill`, `Spinner/Skeleton` primitives.
2. Create shared `LazyPanel` (unifies the 4 identical AI-panel open/fetch patterns).
3. Create shared `ConfirmAction` (currently copy-pasted in `AdminArticleActions`, `AdminMemberActions`, `AdminTagActions`).
4. Add shared `<Header>/<Nav>` for reader-facing app (currently missing entirely).
5. Replace scattered inline `style={{}}` props with layout utilities.
6. Introduce `next/font` and a proper modular type scale.

### Net-New Features Greenlit (in roadmap)
_Proposed by Rusty · 2026-06-19_
- **Reader font/theme controls** (M5): font-size steps + light/sepia/dark theme persisted to localStorage.
- **Saved-word flashcard review** (M6): spaced repetition over existing `SavedWord` model.
- **Reading streaks / daily goal** (M6): new dashboard widget.
- **Global article search** (M4): new search endpoint (Livingston) + search UI.

### Must-Not-Break Constraints (all milestones)
_Proposed by Rusty · 2026-06-19_
Prisma schema & committed migrations; AI graceful degradation (`fallback:true`); NextAuth DB-session + role attach; `middleware.ts` matcher paired with `requireSession`/`requireOnboardedSession`/`requireAdmin`; `sanitizeArticleHtml` always wraps `dangerouslySetInnerHTML`; `ListingProgressSync` DOM contract (`js-progress-bar/label/done`, `data-article-id`); US-030 cache tag invalidation; cached fns prisma-only/date-safe.

---

## Redesign Roadmap M4–M9: COMPLETE
_2026-06-19_

The full user-facing product is now on the Studio design system. Net-new shipped across M4–M9: global search + ⌘K command palette, reader reading-modes (light/sepia/dark) + tabbed AI tools panel + audio mini-player, gamification (streaks/daily-goal/flashcard SRS), 4-step onboarding wizard, daily-goal editing in Settings, admin design-system polish and shared `ConfirmAction`. Every milestone landed green: typecheck 0 · lint 0 · build green · npm test 153/153 (full regression M4–M9 verified by Basher).

---

## Post-redesign features

---

## M10 — Bookmarks & Reading Lists: COMPLETE (c676921)
_2026-06-19 · Saul (spec), Livingston (data + endpoints), Linus (UI), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 191/191 (38 new: 18 lib + 22 route + 1 leftover) · Rusty APPROVE-WITH-NITS · Basher PASS (57 checks, IDOR clean) · committed c676921.

### Scope
Per-user reading lists + quick-bookmark affordance. New `/lists` "Saved" page in the main nav.

### Data layer (Livingston)
- **Migration `m10_reading_lists`** — purely additive. Two new models: `ReadingList` (`@@index([userId])`, `isDefault Bool`) and `ReadingListItem` (`@@unique([listId,articleId])`, `@@index([articleId])`). Back-references on `User` + `Article`. Cascade: User→Lists→Items; Article→Items; List→Items.
- **`src/lib/bookmarks.ts`** — 9 helpers, all ownership-scoped: `getOrCreateDefaultList`, `getUserLists`, `getListWithArticles`, `createList`, `renameList`, `deleteList` (refuses default, 409), `addToList` (idempotent), `removeFromList` (idempotent), `toggleBookmark`, `getBookmarkedArticleIds` (batch), `getArticleListMembership`.
- **8 endpoints** (all `createHandler`, session-gated, 401 unauth, 404 on ownership failure):

| Endpoint | Purpose |
|---|---|
| `GET /api/lists` | User's lists, default first, with count |
| `POST /api/lists` | Create named list (201) |
| `PATCH /api/lists/[id]` | Rename (ownership) |
| `DELETE /api/lists/[id]` | Delete (ownership; 409 on default) |
| `POST /api/lists/[id]/items` | Add article (idempotent) |
| `DELETE /api/lists/[id]/items/[articleId]` | Remove article (idempotent) |
| `POST /api/bookmarks/toggle` | Quick-toggle default list; lazily creates default |
| `GET /api/bookmarks/membership?articleId=` | All lists + hasArticle flags for list-picker popover |
| `POST /api/saved` | Batch bookmark-status check for `ListingBookmarkSync` client refresh |

### UI layer (Linus)
- **`ReaderBookmarkCluster`** — split-pill in `.reader-meta` row (`ml-auto`): Segment A (default-list Save/Saved toggle, `aria-pressed`, indigo filled-Bookmark icon, optimistic + revert, `role="status"` error live region, `rw-pop` on save) + Segment B (`ListPlus` icon, opens `ListPickerPopover`, dot indicator when in any named list).
- **`ListPickerPopover`** — non-modal dialog, membership checkboxes from `GET /api/bookmarks/membership`, inline "New list" creation, focus trap, Escape + outside-click close.
- **`CardBookmarkButton`** — sibling-overlay on cards (never nested in `<Link>`). Root `<div data-card-wrapper data-article-id>` wraps Link (all `.js-progress-*` hooks unchanged) + button sibling. `js-bookmark` / `data-saved` DOM contract.
- **`ListingBookmarkSync`** — client mount-phase hydrator (parallel to `ListingProgressSync`). Reads sessionStorage (`readwise:bookmark-changes`), calls `POST /api/saved`, updates `data-saved` + `aria-pressed` in the DOM.
- **`ListSwitcher`** — desktop sidebar + mobile snap-scroll pill bar; inline create/rename/delete; `ConfirmAction` for delete.
- **`/lists` page** (`src/app/(app)/lists/page.tsx`) — gated with `requireSession("/lists")`; `?list=<id>` URL param; SSR via `getUserLists` + `getListWithArticles` + `getProgressMap` + `getBookmarkedArticleIds`; M4 `EmptyState`.
- **Modified listings** — browse, dashboard, tags, reader all call `getBookmarkedArticleIds` for SSR first-paint; drop `ListingBookmarkSync` where needed.
- **CSS additive** — M10 section: `.js-bookmark[data-saved="true"] svg { fill: currentColor }`, card-removal fade, `.lists-layout` / `.lists-sidebar` / `.lists-mobile-bar` / `.lists-panel-header` / `.lists-mobile-switcher` (900px breakpoint).

### Coordinator decisions
| Decision | Choice |
|---|---|
| Nav label | "Saved" (not "Lists" or "Bookmarks") |
| Route | `/lists` |

### IDOR audit (Rusty)
All routes verified: every helper uses `findFirst({where:{id,userId}})` before mutation. 404 (not 403) on ownership failure — existence not leaked. Double-checked on `/lists` page: `listParam` resolved only within userId-filtered results; `getListWithArticles` adds second ownership layer. **No IDOR path found.**

### Deferred nits (Rusty, non-blocking)
| ID | Item |
|---|---|
| N1 | `getOrCreateDefaultList` lacks DB-level `@@unique` guard on `(userId, isDefault=true)`; narrow concurrent-first-use race; degrades gracefully |
| N2 | `renameList`/`deleteList` TOCTOU between ownership check and mutation (safe in practice with CUIDs) |
| N3 | `ListSwitcher` uses `role="tablist"` + `role="tab"` on `<Link>` — should be `role="navigation"` + `aria-current="page"` |
| N4 | Dual DOM trees (desktop sidebar + mobile pill bar) lack `aria-hidden` on the hidden copy |
| N5 | `CategoryBrowser` "Load more" cards default `saved=false` (no batch in `GET /api/articles` yet) |
| N6 | `ConfirmAction className="!p-0"` in `ListSwitcher` (Tailwind `!important` override; no functional impact) |

---

## M9 — Command Palette + Final A11y/Motion QA: COMPLETE (dff6c1f)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 153/153 · Rusty APPROVE-WITH-NITS · Basher PASS (full M4–M9 regression) · committed dff6c1f.

### Scope
⌘K command palette (headline feature, reuses `GET /api/search`); global `:focus-visible` ring baseline; reduced-motion baseline for all animations; 15-nit sweep across M5–M8/shell.

### What shipped

**Pass A — Command palette (Linus)**
- `src/components/command/CommandPalette.tsx` — modal: overlay/panel, combobox+listbox ARIA engine (focus stays on input; `aria-activedescendant` drives highlight), all states (empty-query, loading skeletons, results, no-results, error, show-more pagination).
- `src/components/command/CommandPaletteProvider.tsx` — global ⌘K / Ctrl+K / `"/"` (outside editable) listener; `useCommandPalette()` context; mounts only in the authed app shell.
- `src/components/command/command-items.ts` — static Pages + Actions definitions, fuzzy scorer.
- `src/components/command/useArticleSearch.ts` — debounced (200ms), abortable fetch against `GET /api/search`; `latestQueryRef` stale-response guard in `search()`.
- `src/components/shell/HeaderSearch.tsx` — desktop faux search-box + mobile icon button (resolves M2 N4).
- **Global `:focus-visible` ring** (`@layer base`, `:where(...)` zero-specificity — resolves M1/M2 N2).
- Reduced-motion block: `animation:none !important; opacity:1 !important; transform:none !important` (identity, not duration-0) for all palette animations.

**Pass B — 15-nit sweep (Linus)**
- NIR-M5-1: `isMobile` media-query state in `ReaderToolsPanel`; `PanelContents` renders in only one slot; split `asideTabListRef`/`sheetTabListRef`.
- NIR-M5-2 + focus-trap: `closeButtonRef` focus on sheet open; full `getFocusable` Tab-trap; `fabRef` focus restore on close.
- M6 `extendedToday`: real value wired to StreakWidget flame flicker.
- M6 StudyList dim: `StudyPageShell` lifts `reviewing` bool; `inert + aria-hidden + opacity-60` on saved-words list while reviewing.
- M6 `rw-pop` SSR: `GoalMetIcon` client component suppresses animation on initial mount (SSR flash fixed).
- M7 N1: daily-goal input `onBlur` clamp `[DAILY_GOAL_MIN, DAILY_GOAL_MAX]`.
- M7 N2: stepper pills → `<nav aria-label="Onboarding progress"><ol>` + `<li aria-current="step">`.
- M7 N4: `LEVEL_HINTS` exported from `src/lib/profile.ts`; duplicate removed from both forms.
- M8 N1: `ConfirmAction` controlled mode (`open`/`onOpenChange` props); `AdminArticleActions` mutual exclusion via `openPanel` state.
- M8 N2: `statusBadgeVariant()` extracted to `src/lib/admin.ts`; three consumers updated.
- M8 N3: `ConfirmAction` `useId()` `msgId`; `aria-describedby` + `id` on alertdialog `<p>`.
- M8 N4: `.admin-actions { min-width: 220px }` restored.
- M1 N3: `Spinner` track uses `stroke="var(--border)"` (theme-aware token).
- M2 N3: `aria-label` removed from `role="menu"` div in `UserMenu`.

**Pre-land fixes (Linus, per Rusty FIX-BEFORE-LAND)**
- FIX-1: `aria-expanded={true}` on combobox input (was `selectableItems.length > 0` — ARIA violation when "No results" shown).
- FIX-2: `loadMore` stale-response guard added (mirrors existing `search()` `latestQueryRef` pattern).

### Coordinator decisions
| Decision | Choice |
|---|---|
| Command palette scope | Palette-only — no standalone `/search` page (reuses `GET /api/search` via palette) |
| `GoalMetIcon` reactive pop | Accepted no-op: SSR flash fixed; reactive not-met→met animation deferred (no client-observable goal-met signal available in M9) |

### Post-M9 nits (Rusty, deferrable)
| ID | Item |
|---|---|
| NIT-1 | `GoalMetIcon` reactive animation dead letter — gate `setPop` on a client-observable "goal just became met" signal |
| NIT-2 | `loadMore` stale-query guard (applied as FIX-2 pre-land; noted for completeness) |

---

## M8 — Admin Design System Polish: COMPLETE (a631aa9)
_2026-06-19 · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (41 routes) · npm test 153/153 · Rusty APPROVE · Basher PASS · committed a631aa9.

### Scope
Surface-polish only: map `/admin` onto Studio design system (M1 primitives + tokens), extract shared `ConfirmAction`. No behavior, gating, API, or schema changes.

### What shipped
- **`ConfirmAction`** (`src/components/ConfirmAction.tsx`, `"use client"`): `role="alertdialog"`, focus→Cancel on open, Escape closes+returns focus to trigger, `aria-expanded`/`aria-busy`. Props: `triggerLabel`, `triggerVariant`, `confirmVariant`, `onConfirm`, `loading`, `disabled`/`disabledTitle`.
- **`CardTitle level` prop** (N3 from M7): `"h2"|"h3"|"h4"` default `"h3"` — non-breaking; `CardTitleProps` re-exported. Settings cards now use `level="h2"`.
- **AdminNav**: indigo pill active link (`border-primary text-primary-text color-mix(primary 8%)`) — coordinator decision; never teal; `aria-current="page"` preserved.
- **3 action components refactored**: `AdminArticleActions`, `AdminMemberActions`, `AdminTagActions` — all use `ConfirmAction`; Playwright selectors `.admin-actions`/`.admin-actions-row`/`.admin-confirm` preserved.
- **5 admin pages migrated**: M1 `Card`/`Badge`/`CefrBadge`/`Input`/`Select`/`Button` throughout; `tabIndex`+`aria-label` on scrollable table wrappers.
- **`globals.css` tokenized**: admin block hardcoded hex removed (`#20242d`, `#3a1d22`/`#7f3a44`/`#ffb4bd`); retired classes carry `/* retired — M8 */` (kept for Playwright); `.admin-table tr:hover td` indigo hover added.

### Coordinator decision
| Decision | Choice |
|---|---|
| AdminNav active state | Indigo pill — never teal (teal = reading-state only) |

### Deferred nits → M9
| ID | Item |
|---|---|
| N1 | `AdminArticleActions` dual-open ConfirmAction panels (no mutual exclusion) |
| N2 | `statusBadgeVariant()` copy-pasted 3× — extract to `src/lib/admin.ts` |
| N3 | ConfirmAction `<p>` lacks `id`+`aria-describedby` on alertdialog |
| N4 | `.admin-actions { min-width:220px }` dropped — validate narrow-width in M9 QA |

---

## M7 — Onboarding / Auth / Settings Polish + Daily-Goal: COMPLETE (cb204c5)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Livingston (backend), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (31 routes) · npm test 153/153 · Rusty APPROVE · Basher PASS (73 checks) · committed cb204c5.

### Scope
Polish sign-in, onboarding, and settings onto the Studio design system; turn onboarding into a 4-step wizard; add the daily-goal stepper deferred from M6 (D4).

### What shipped
- **Sign-in**: branded `<Card>` layout, Wordmark + ThemeToggle top-bar, error-banner mapping (`OAuthAccountNotLinked`/`AccessDenied`/generic), `rw-fade-up` entrance, neutral `LogIn` icon on provider buttons.
- **Onboarding**: 4-step wizard (`englishLevel` → `topics[]` → `ageRange/gender` → review) with segmented-pill stepper, `aria-live` progress, `key={step}` remount + `useEffect([step])` heading focus, `CefrBadge` radio-cards, step-4 Edit-jump. POSTs identical `{englishLevel,topics,ageRange,gender}` body to `/api/onboarding` — no `dailyGoal`; DB default 2 applies. `completedAt` server-side unchanged.
- **Settings**: 3 `<Card>` sections (Profile / Reading preferences / Account). Daily-goal `−/input/+` stepper range `[1,10]`; out-of-range typed input clamped; `PUT /api/profile` body includes `dailyGoal`.
- **Backend (Livingston)**: `parseProfileInput` extended with `dailyGoal?: number` (hard-reject non-integer/out-of-range; omitted → no DB update). Constants `DAILY_GOAL_{MIN,MAX,DEFAULT}` exported. 9 new tests (144 → 153 total).
- **CSS**: `@keyframes rw-step` + `.rw-step` + `prefers-reduced-motion` no-op, additive only.

### Coordinator decisions
| Decision | Choice |
|---|---|
| Provider button icons | Neutral `LogIn` lucide icon — no brand logos |
| Daily-goal range | 1–10 integer (`DAILY_GOAL_{MIN,MAX}`) |

### Deferred nits → M9
| ID | Item | Owner |
|---|---|---|
| N1 | Typed number-input `onBlur` clamp for out-of-range entry | Linus |
| N2 | Stepper pills: `<nav><ol>` or `role="tablist"` | Linus |
| N3 | `CardTitle` `level` prop (settings uses bare `<h2>`) | M8 |
| N4 | `LEVEL_HINTS` duplication across OnboardingForm + ProfileSettingsForm | Linus |

---

## M6 — Dashboard & Study Gamification: COMPLETE (1beea38)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Livingston (data), Linus (UI), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (31 routes) · npm test 144/144 · Rusty APPROVE-WITH-NITS · Basher PASS (87 checks) · committed 1beea38.

### Scope
Light gamification only (coordinator decision): reading streaks, daily goal, and flashcard SRS. No XP, badges, leaderboards, or social features.

### What shipped

**Data layer (Livingston + F1)**
- Additive migration `20260619080608_m6_gamification`: new `DailyActivity` model (`@@unique([userId, date])`, tracks `articlesRead` per UTC calendar day, cascade on User); `SavedWord` +5 SRS columns (`dueAt?`, `intervalDays` 0, `easeFactor` 2.5, `repetitions` 0, `lastReviewedAt?`); `Profile.dailyGoal Int @default(2)`.
- `src/lib/srs.ts` — pure SM-2 engine. Grades: again (reset reps+interval=1, EF−0.2), hard (q=3, EF−0.14, 0.6× interval cap), good (q=4, EF stable), easy (q=5, EF+0.10). EF floor 1.3.
- `src/lib/activity.ts` — `recordReadingActivity` (re-counts distinct articles from ReadingProgress today, upserts DailyActivity — idempotent); `getStreakSummary` (currentStreak anchors today or yesterday, longestStreak, last7Days dot-row, dailyGoal from Profile).
- `src/lib/flashcards.ts` — `getDueFlashcards` (dueAt≤now OR null, nulls-first), `gradeFlashcard` (ownership check, SM-2 apply, persist), `getReviewSummary`.
- `src/lib/progress.ts` — `saveProgress` wires `recordReadingActivity` as try/catch side-effect; forward-only semantics preserved.
- 3 new session-gated endpoints: `GET /api/gamification/summary` → `{currentStreak, longestStreak, dailyGoal, todayProgress, last7Days[7], dueCount}`; `GET /api/study/flashcards` → `{cards, dueCount}`; `POST /api/study/flashcards/grade` body `{savedWordId, grade}` → `{dueAt, dueCount}` (400/401/404).
- **F1 (Livingston):** corrected `srs.ts` line 42 doc-comment: "1.2× interval multiplier cap" → "60% (0.6×) interval cap". No logic change; typecheck/lint/144 tests green.

**UI layer (Linus + F2)**
- `StreakWidget` (server): teal `Flame` 28px, `--text-4xl` count, 10px dot row (teal active / `border-border` inactive / `outline-2` today ring), `Award` longest-streak sub-stat; zero-streak state ("Start a streak today").
- `DailyGoal` (server): 72×72 SVG progress ring; teal un-met → success met; `role="progressbar"` + aria attrs; `rw-pop` on `Check` icon; "Adjust goal" → `/settings` (editing deferred M7).
- `FlashcardReview` (`"use client"`): state machine idle→loading→session→complete; 3D flip card; 4 indigo-anchored grade buttons (Good = solid indigo `variant="primary"`, Again/Hard/Easy = outline + status-tinted icon+hover); keyboard (Space/Enter flip, 1–4 grade, Esc end); `appStateRef` stale-closure guard; `aria-live="polite"` region; optimistic grading; `.rw-flip`/`.rw-flip-inner`/`.rw-flip-face`/`.rw-flip-back` CSS.
- Dashboard: `getStreakSummary` in `Promise.all`; "Your progress" stats band (StreakWidget + DailyGoal, `grid-cols-1 md:grid-cols-2`) between identity card and continue-reading rail. Heading order H1→H2 "Your progress" (H3s inside cards)→H2 "Browse" ✓.
- Study page: `getReviewSummary` SSR; `FlashcardReview` above saved-words section; `listing-container` max-width; `<h2>Saved words</h2>` heading added.
- CSS additive: `@keyframes rw-flame-flicker`, `rw-pop`, `.rw-flip*` family; `prefers-reduced-motion` → opacity crossfade fallback (no 3D rotation, no flicker/pop).
- **F2 (Linus):** wired `hoverStyle` in `GradeButtons` map (`style={hoverStyle}` + `hover:bg-[color:var(--hover-bg)]`); status-tinted hover now renders for Again/Hard/Easy.

**Tests:** 40 new tests — `srs.test.ts` (17), `activity.test.ts` (13), `gamification.test.ts` (10). 144/144 total, 0 regressions.

### Key decisions
| Decision | Choice |
|---|---|
| Gamification depth | Light only — no XP, badges, leaderboards (coordinator) |
| Grade button anchor | Good = solid indigo (`variant="primary"`); others = outline + status icon (coordinator) |
| Daily-goal editing | Read-only in M6; editing deferred to M7 (coordinator) |
| Accent rule | Streak flame + dots + goal ring = reading-state → teal (legitimate per accent rule) |
| `extendedToday` flame-flicker | Prop wired but always `false`; sessionStorage derivation deferred to M7 |
| StudyList dimming during review | Deferred M7 (sibling component; needs context or `data-` attr on `<main>`) |

### Deferred
| ID | Item | Owner | When |
|---|---|---|---|
| D1 | `extendedToday` flame pulse (flicker fires on streak extension) | Linus | M7 |
| D2 | StudyList `opacity-60 pointer-events-none` during active review | Linus | M7 |
| D3 | `rw-pop` reactive on goal-met (currently SSR, plays on each load if goal already met) | Linus | M7 |
| D4 | Daily-goal editing in Settings | Saul + Linus | M7 |
| D5 | Session-complete focus (`doneButtonRef`) | Linus | M7 |
| N4 | `aria-valuetext` on session progress bar + daily-goal ring | Linus | M9 a11y |

---

## M5 — Reader Redesign: COMPLETE (f199596)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green (28 routes) · npm test 108/108 · Rusty APPROVE-WITH-NITS · Basher PASS (77 checks) · committed f199596.

### What shipped
- **Two-column reader layout** — reading column capped at `--measure` (66ch, Literata); sticky tools rail (≥1100px desktop); mobile bottom-sheet + FAB; outer grid `minmax(0,1fr) 360px; max-width:1160px; margin-inline:auto`.
- **`ReaderControls`** — sticky cluster: 5-step Aa−/Aa+ font-scale stepper + Light/Sepia/Dark segmented radio; roving-tabindex radiogroup; `aria-live` announcements; prefs persisted to `readwise:reader-prefs` localStorage.
- **Reading-mode token architecture** — `data-reading-mode` set on `#reader-root` ONLY (never `<html>`); `src/lib/reader-prefs.ts` mirrors `theme.ts`; no-flash inline script placed as **first child** of `#reader-root` (uses `document.currentScript.parentElement` — D5 fix); `suppressHydrationWarning` on `#reader-root`; sepia adds exactly 8 WCAG-verified hex values to `tokens.css` (additive-only).
- **AI tabbed panel** (`ReaderToolsPanel`) — Listen · Words · Quiz · Translate; panels stay **mounted** via `hidden` attribute (no unmount on tab switch); lazy-load fires once per panel per page-load via `hasFetched` ref guard; roving tabindex + arrow keys; desktop sticky rail + mobile bottom-sheet.
- **Shared audio context** (`ReaderAudioProvider`) — single `<audio>` element; `updateActiveWord` binary-search via `useCallback([words])` (stale-closure-free); `loadAudio(src,words)` / `markFallback()`; `audioRef` stable across mini-player + listen tab.
- **`ReaderMiniPlayer`** — fixed-bottom transport: Play/Pause, Skip ±10s, seek bar (teal fill), time display, speed select (0.75×/1×/1.25×/1.5×), close button; renders only when `isLoaded && !isFallback && !dismissed`.
- **Article header** — M1 `CefrBadge` (CEFR level), `Badge variant="neutral"` (⏱ reading time), `Badge variant="success"` (✓ Completed when progress.completed); hero image `border-radius:var(--radius-lg)` + slight bleed; tags as `.tag-chip` links.
- **`<main id="main-content">` landmark** added to reader page (NIR-M5-3 pre-land fix); consistent with marketing skip-link target.
- **No schema changes.** `ReaderProgress` (forward-only scroll tracking, `markArticleVisited`), `sanitizeArticleHtml`→`WordLookup` (`dangerouslySetInnerHTML`) pipeline, and `ListingProgressSync` DOM contract (`js-progress-bar/label/done`, `data-article-id`) — all preserved verbatim.

### Key decisions
| Decision | Choice |
|---|---|
| Default reading mode | Resolved global theme (inherits `data-theme` from `<html>`) |
| Mini-player controls | Skip ±10s + close button included |
| Hero image width | Slight bleed (up to `min(100%,760px)`) — visual punch, body stays at 66ch |
| Reading-mode scope | `data-reading-mode` on `#reader-root` only; dark chrome + light reading works |
| AI panel lifecycle | Stay MOUNTED via `hidden`; fetch guard via `hasFetched` ref |
| Audio architecture | Single `<audio>` shared by listen tab + mini-player via React context |

### Deferred nits
| ID | Item | Owner | When |
|---|---|---|---|
| NIR-M5-1 | Double-mount of `PanelContents` on mobile (aside CSS-hidden + sheet both live; two API calls per panel, idempotent, no correctness bug) | Linus | M6 |
| NIR-M5-2 | `firstFocusRef` never assigned; bottom-sheet opens with no focus-move (ARIA dialog requires focus inside on open) | Linus | M9 a11y |
| Mobile focus-trap | Tab-cycling within bottom-sheet does not cycle back (Escape + scrim-click close work correctly) | Linus | M9 a11y |
| Speech synthesis latency | First-generation TTS can exceed 60s on some articles | Noted | M9 perf |

---

## M4 — Listings & Discovery: COMPLETE (7e554c9)
_2026-06-19 · Yingting Huang (requester) · Saul (spec), Linus (build), Livingston (search endpoint), Rusty (review), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · npm test 108/108 · Rusty APPROVE-WITH-NITS · Basher PASS (121 checks) · committed 7e554c9.

### What shipped
- **`ArticleCardView` full redesign** — M1 tokens, `variant="grid"|"rail"` prop, `CefrBadge`, byline, teal reading-state progress fill, done-chip "Read", hover/focus lift (`-translate-y-0.5`+`shadow-md`+`border-border-strong`+indigo title), `motion-reduce:transform-none`. **All 5 ListingProgressSync DOM hooks preserved verbatim** (sacred contract).
- **Continue-reading rail** (dashboard) — horizontal snap-scroll `role="region"`, in-progress articles via new `listInProgressArticles` helper in `src/lib/progress.ts`.
- **`EmptyState`** (`src/components/EmptyState.tsx`) — branded empty state with icon chip (`aria-hidden`), title, description, optional M1 Button-styled action link.
- **`SkeletonCard` + `SkeletonCardGrid`** (`src/components/SkeletonCard.tsx`) — M1 `Skeleton`/`SkeletonText`-based card placeholder.
- **Listing pages migrated** — dashboard (M1 identity `Card`, continue-reading rail, M1 `Select`+`Button` level filter), `CategoryBrowser` (indigo active tab, `EmptyState`, M1 `Button loading` for load-more), `tags/[slug]`, reader "related" section — all use `listing-container` (1200px max-width) + §2.1 responsive grid (1/2/3-col).
- **`GET /api/search`** — session-gated global search over published articles (`title/author/source` LIKE, case-insensitive). Response mirrors `GET /api/articles` shape. Blank query → empty array, no DB hit. 7 tests added (`tests/search.test.ts`).
- **`package.json`** — added `--experimental-strip-types` to `npm test` (Node 22.14.0 explicit requirement; pre-existing gap fixed by Livingston).

### Key decisions
| Decision | Choice |
|---|---|
| Category tab active colour | Indigo (`--primary`) — NOT teal (teal = reading-state only) |
| `listInProgressArticles` query | Separate DB query (cleaner rail, accepts ~1 extra round-trip) |
| Search caching | NOT cached (open-ended query keys, per-user progress merged) |
| Search scope for M4 | title / author / source LIKE; level+category+tag filters deferred to M9 |
| `SkeletonCardGrid` load-more wiring | Deferred (Button spinner used instead); M8 if desired |

### Deferred / nits (Rusty APPROVE-WITH-NITS)
| ID | Item | Owner | When |
|---|---|---|---|
| NIR-1 | `listInProgressArticles`: move published filter into Prisma `where` (currently JS-side; `take` may under-fill rail when unpublished rows exist) | Linus | M4.1 (in-progress cleanup) |
| NIR-2 | `--experimental-strip-types` absent from `npm run scrape\|process\|worker\|seed` | Linus | M4.1 / CI |
| NIR-3 | Duplicate `role="region"` landmark on continue-reading rail (`<section aria-label>` + inner `<div role="region">`) | Linus | M8 a11y pass |
| NIR-4 | Two separate `@/lib/cn` imports in `CategoryBrowser.tsx` | Linus | M4.1 |
| M4-F3 | `ListingProgressSync` `querySelector` refreshes first DOM match only when article appears in both rail+grid; true dual-refresh needs `querySelectorAll` | Livingston/Linus | M8 |

_Linus nit-cleanup follow-up (NIR-1 through NIR-4) is in progress._

---

## M3 — Landing / Marketing Page: VERIFIED · COMMITTED 2824eea
_2026-06-19 · Yingting Huang (requester) · Saul (UX spec), Linus (build), Basher (verify)_

**Status: LANDED** — typecheck 0 · lint 0 · build green · Basher PASS (30/30 browser checks) · committed 2824eea.

**D3 follow-up (non-blocking):** Final CTA band — `Button variant="secondary"` in dark theme renders dark surface on gradient (14:1 WCAG AAA contrast ✓). Aesthetically "dark card on colourful gradient" rather than "white/indigo on gradient." Flagged for Saul sign-off before M9 polish pass.

### What shipped
- **`src/app/page.tsx`** — server component, auth-aware via `getServerSession(authOptions)`, `export const metadata` (SEO), 6 sections (Marketing Header, Hero, Features, How It Works, Social Proof, Final CTA Band), skip-link target `#main-content`.
- **`src/components/marketing/`** — `MarketingHeader.tsx` (server, glass sticky, wordmark + ThemeToggle + auth-aware outline CTA), `MarketingFooter.tsx` (server), `Wordmark.tsx` (inline-SVG diamond glyph + Space Grotesk logotype, `<a href="/">`), `MockReaderCard.tsx` (client, pure-CSS hero reader mock with JS 3D tilt), `FeatureCard.tsx` (server, M1 Card + 3px left-border accent + Lucide icon chip + feature list), `StepCard.tsx` (server, numbered step + horizontal connector via `::after`), `Reveal.tsx` (client, IntersectionObserver scroll-reveal wrapper).
- **`src/app/globals.css`** (ADD-only) — `@keyframes rw-fade-up` at top level; `.text-gradient-brand`, `.rw-fade-up`, `.rw-reveal`, `.rw-revealed` in `@layer utilities`; `prefers-reduced-motion` override. No existing rules altered.
- **Auth-aware state**: signed-out → primary CTA "Get Started — It's Free" + ghost "Sign In"; signed-in → primary "Continue Reading →", secondary hidden.
- **Design language**: brand gradient H1 text-clip, radial-orb hero background, glass sticky marketing header (standalone — outside M2 app shell).

### Deviations from Saul's spec (Basher verified)
| ID | Deviation | Reason |
|---|---|---|
| M3-D1 | `font-bold` (700) for H1/CTA H2 vs spec 800 | Space Grotesk loaded up to 700; `layout.tsx` out of scope |
| M3-D2 | Header scroll-shadow omitted | Keep header server component; glass blur + border provide separation |
| M3-D3 | Final CTA band: `Button variant="secondary"` dark surface + light text on gradient | AA contrast; intentional look. _(D3 follow-up: Saul sign-off pending, see status above)_ |
| M3-D4 | CTAs are `<Link className={buttonVariants(...)}>` | M1 Button has no `asChild`; keyboard + focusRing preserved |

---

## M2 — Global App Shell: COMPLETE (385de06)
_2026-06-19 · Yingting Huang (requester) · Saul, Rusty, Linus, Basher_

**Status: LANDED** — typecheck 0 · lint 0 · build green · browser verification passed · committed 385de06.

### What shipped
- **Route group `src/app/(app)/`** — six authed reader folders (`dashboard`, `browse`, `reader`, `study`, `settings`, `tags`) moved under URL-transparent route group. `middleware.ts` and all `requireSession`/callbackUrl strings byte-unchanged.
- **`src/app/(app)/layout.tsx`** (server) — reads `getServerSession` for display only (user menu + role-gated admin link); does not gate; null-session-safe.
- **`src/lib/theme.ts`** (closes N4) — 3-state `Theme = "light"|"dark"|"system"`, key `readwise:theme`, SSR-safe. Compatible with existing no-flash script; `"system"` deletes `data-theme` so CSS `prefers-color-scheme` fallback wins.
- **`src/components/shell/`** — `AppShell`/`AppHeader` (server), `HeaderShell` (client sticky+scroll-shadow), `AppNav` (client usePathname active state), `ThemeToggle` (client 3-state Sun/Moon/Monitor, mounted-guard), `UserMenu` (client avatar+popover+signOut), `MobileDrawer` (client hamburger+scrim+focus-trap), `AppFooter` (client self-hides on `/reader*`/`/settings*`). Shared `nav-items.ts` (`PRIMARY_NAV` + `isActivePath`) reused by AppNav + MobileDrawer; `types.ts` ShellUser.
- **Accent rule (FINAL — resolves OPT-A from M1):** `--accent` stays aliased to `--primary` (indigo) — interactive affordances only. Added `--bg-accent: var(--teal)` / `--text-accent: var(--teal-text)` semantic aliases. Teal used ONLY for reading-state: active nav underline (2px), progress bars, CEFR badges. Teal is NEVER a clickable affordance.
- **Stripped** bespoke back-links/footer rows from all six pages; removed unused `Link`/`SignOutButton` imports; dashboard's in-content Admin button moved to UserMenu/Nav.
- **D1 fix:** legacy unlayered `a { color: var(--accent) }` in globals.css moved into `@layer base` so Tailwind utility classes override it (inactive nav links now render correct slate gray).

### Open / deferred items
| ID | Item | Owner | When |
|---|---|---|---|
| N3 | UserMenu trigger + popover both carry `aria-label="User menu"` (minor ARIA redundancy — screenreaders may announce twice) | Linus | M8 a11y pass |
| N4 | Search placeholder hidden below 640px (`hidden sm:inline-flex`) — revisit if M4 makes search prominent on mobile | Linus | M4 |

---

## M1 — Design System Foundation: COMPLETE
_2026-06-19 · Yingting Huang (requester) · Rusty, Saul, Linus, Basher_

**Status: LANDED** — typecheck 0 errors · lint 0 errors · build green (27 routes) · both themes verified · working tree clean (DEFECT-1 fixed).

### What shipped
- **Tailwind CSS v4** (`tailwindcss@4.3.1` + `@tailwindcss/postcss@4.3.1`, CSS-first, no `tailwind.config.js`) layered non-destructively over `src/app/globals.css`.
- **`src/app/tokens.css`** — single source of truth: theme-invariant scales (type/spacing/radii/motion + `prefers-reduced-motion`) on `:root`; semantic color + elevation tokens with light as `:root` default, dark via `:root[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` no-JS fallback. Saul's exact hex values (WCAG AA verified).
- **Legacy aliases preserved** (`--panel→--surface`, `--muted→--text-muted`, `--accent→--primary`; `--bg/--text/--border` kept first-class). 957-line `globals.css` fully intact below the new header.
- **Theme mechanism:** blocking inline `<head>` script sets `data-theme` pre-paint (no FOUC). Storage key: `readwise:theme` (`"light"|"dark"`). Visible toggle deferred to M2.
- **3 `next/font/google` families:** Inter (`--font-sans`), Space Grotesk (`--font-display`), Literata (`--font-reading`).
- **8 UI primitives** in `src/components/ui/*` + `src/lib/cn.ts` (clsx + tailwind-merge + shared `focusRing`): Button, Card (+sub), Input, Select, Field/Label, Badge (+CefrBadge A1–C2, CategoryBadge), Skeleton (+SkeletonText), Spinner. All cva-variant, token-driven, zero `"use client"`, RSC-compatible. Exported via barrel; feature pages NOT yet migrated.
- **New deps:** `lucide-react@1.21.0`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `class-variance-authority@0.7.1`.

### Review & verify verdicts
- **Rusty (code-review gate):** APPROVE-WITH-NITS — no blockers; 5 nits tracked below.
- **Basher (independent verify):** CONDITIONAL PASS — 1 defect (DEFECT-1) found and fixed; theme/focus/primitives/regressions all pass.
- **DEFECT-1 (fixed):** `suppressHydrationWarning` was missing on `<html>` in `layout.tsx`; added by Linus before landing.

### Open / deferred items
| ID | Item | Owner | When |
|---|---|---|---|
| OPT-A | `--accent` split: CSS var = indigo (legacy continuity); teal exposed as `--teal*` + Tailwind `accent` utility for new components. Confirm or flip (one-line change in `tokens.css`). | Saul + Yingting | M2 kickoff |
| N2 | Global `:focus-visible` CSS rule (currently only on primitives via `focusRing`; legacy pages use browser defaults) | Linus | M8 a11y pass |
| N3 | Spinner track: `strokeOpacity="0.2"` vs `color-mix(…, var(--border))` per Saul spec | Linus | M8 a11y pass |
| N4 | Create `src/lib/theme.ts` `setTheme()` helper for M2 to consume | Linus | Before M2 theme toggle |
| N5 | `--text-inverted` added as `var(--bg)` — Saul to confirm value | Saul | M2 kickoff |

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
