# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M1–M5 Summary (2026-06-19) [condensed]

**M1 — Design System Foundation** ✅ committed (within M1)
- Tailwind CSS v4 CSS-first (no config file); token layer = `src/app/tokens.css` (`:root` + `[data-theme="dark"]` + `@media` fallback); legacy 6 vars aliased. `--accent` = indigo (legacy continuity); teal exposed as `--teal*` / `--bg-accent` / `--text-accent`.
- `@theme inline` gotcha: only `--color-*` is collision-free; non-color tokens used via arbitrary values (`rounded-[var(--radius-md)]` etc.). Primitives in `src/components/ui/*` (Button, Card, Input, Select, Field/Label, Badge/CefrBadge/CategoryBadge, Skeleton, Spinner) — built/exported only, feature pages not touched.
- Theme: blocking inline `<head>` script sets `data-theme` pre-paint (no FOUC). `src/lib/theme.ts`: 3-state `"light"|"dark"|"system"`, `applyTheme("system")` deletes attribute so CSS media fallback wins.

**M2 — Global App Shell** ✅ committed 385de06
- Route group `src/app/(app)/` (URL-transparent): moved dashboard/browse/reader/study/settings/tags under it — middleware.ts + all `requireSession` strings byte-unchanged. `(app)/layout.tsx` reads session for DISPLAY only; pages keep own gates.
- Shell: `AppShell`→`AppHeader`→`HeaderShell`(sticky)/`AppNav`(roving active underline teal)/`ThemeToggle`(3-state)/`UserMenu`/`MobileDrawer`(focus trap). `AppFooter` self-hides via `usePathname` on `/reader*`/`settings*`. `a { color: var(--accent) }` moved to `@layer base` (D1 fix — lets Tailwind utilities override).

**M3 — Landing Page** ✅ committed 2824eea
- Only `src/app/page.tsx` + `src/components/marketing/*` + ADD-only `globals.css`. Auth-aware (server): signed-out = "Get Started" CTA, signed-in = "Continue Reading". CTAs = `<Link className={buttonVariants(...)}>`. Motion: `.rw-fade-up` keyframes + `<Reveal>` IntersectionObserver; `prefers-reduced-motion` `!important` no-op block. `text-gradient-brand` = `color:var(--primary-text)` fallback + `-webkit-text-fill-color:transparent` clip.

**M4 — Listings & Discovery** ✅ committed 7e554c9
- `ArticleCardView`: `variant="grid"|"rail"`, `CefrBadge`, teal progress fill (`bg-[var(--bg-accent)]`), done-chip "Read" (`.js-progress-done`), hover lift. **5 `ListingProgressSync` DOM hooks preserved verbatim** (`js-progress-bar/label/done` + `data-article-id`) — sacred contract. New: `EmptyState`, `SkeletonCard`/`SkeletonCardGrid`. All listing pages use `listing-container` (1200px) + 1/2/3-col responsive grid. `listInProgressArticles` added to `progress.ts` (published filter JS-side, NIR-1 pending).

**M5 — Reader Redesign** ✅ committed f199596
- Two-column layout (66ch prose/Literata, sticky rail ≥1100px, mobile FAB+bottom-sheet). `data-reading-mode` on `#reader-root` ONLY — no-flash script as first child (uses `document.currentScript.parentElement`). `ReaderAudioProvider` context: single `<audio>`, `updateActiveWord` via `useCallback([words])` (stale-closure-free). AI tabs (Listen/Words/Quiz/Translate) stay mounted via `hidden`; lazy `hasFetched` guard. `ReaderMiniPlayer`: Play/Pause, skip ±10s, seek, speed, close. Sepia: 8 WCAG-verified hex values additive in `tokens.css`. Pre-land D5: no-flash script position fix (Basher).

### M6 — Dashboard & Study Gamification (2026-06-19) ✅ SHIPPED — committed 1beea38
- **New components**: `StreakWidget` (server — teal Flame 28px, `--text-4xl` count, 10px dot row with today ring, Award longest-streak sub-stat, zero-streak state); `DailyGoal` (server — 72×72 SVG ring, teal un-met → success met, `role="progressbar"`, `rw-pop` on Check, `/settings` link); `FlashcardReview` (`"use client"` — idle→loading→session→complete state machine, 3D `.rw-flip` card, 4 grade buttons with `appStateRef` stale-closure guard, keyboard Space/Enter/1–4/Esc, `aria-live` region, optimistic grading).
- **Dashboard wiring**: `getStreakSummary` in `Promise.all`; "Your progress" band (`grid-cols-1 md:grid-cols-2`) between identity card and continue-reading rail. Heading order H1→H2 "Your progress"→H3s inside cards→H2 "Browse" ✓.
- **Study page wiring**: `getReviewSummary` SSR; `FlashcardReview` above saved-words section; `listing-container` max-width; `<h2>Saved words</h2>` heading added.
- **CSS additive**: `@keyframes rw-flame-flicker`, `rw-pop`, `.rw-flip*` family; `prefers-reduced-motion` → opacity crossfade fallback.
- **Pre-land fix F2**: destructured `hoverStyle` in `GradeButtons` map; added `style={hoverStyle}` + `hover:bg-[color:var(--hover-bg)]` to outline buttons; status-tinted hover renders for Again/Hard/Easy.
- **Deferred to M7**: extendedToday flame pulse (D1), StudyList dimming (D2), rw-pop reactive (D3), daily-goal editing (D4). Session-complete focus (D5 → M7). a11y aria-valuetext (N4 → M9).
- **Validation**: typecheck 0 · lint 0 · build 31 routes · 144/144 tests. Rusty APPROVE-WITH-NITS; Basher PASS (87 checks).

### M7 — Onboarding / Auth / Settings Polish + Daily-Goal (2026-06-19) ✅ SHIPPED — committed cb204c5
- **Sign-in**: `<Card>` branded layout, Wordmark + ThemeToggle top-bar, error-banner mapping, `rw-fade-up` entrance, neutral `LogIn` icon on provider buttons (per coordinator — no brand logos).
- **Onboarding**: 4-step wizard (`englishLevel` → `topics[]` → `ageRange/gender` → review). `key={step}` remount + `useEffect([step])` heading focus for screen-reader focus management. `CefrBadge` radio-cards (`has-[:focus-visible]` ring on label, `<fieldset>/<legend>`). Chip grid with `aria-pressed` + `role="group"`. Step-4 review with per-step Edit-jump buttons. Submits identical `{englishLevel,topics,ageRange,gender}` to `/api/onboarding` — `completedAt` server-side unchanged.
- **Settings**: 3 `<Card>` sections (Profile / Reading preferences / Account). Daily-goal `−/input/+` stepper, range `[DAILY_GOAL_MIN=1, DAILY_GOAL_MAX=10]`, buttons carry `aria-label`, `<Input>` linked via `htmlFor`/`aria-describedby`. PUT body includes `dailyGoal`. `markDirty()` clears save confirmation on any field edit.
- **CSS**: `@keyframes rw-step` + `.rw-step` + `prefers-reduced-motion` block entry; additive only. One apostrophe lint fix mid-build.
- **Heading note**: Settings cards need `<h2>` per spec; `CardTitle` renders `<h3>` — used bare `<h2>` with CardTitle CSS classes (no M1 component modified, deferred N3 to M8).
- **Deferred nits → M9/M8**: N1 number-input `onBlur` clamp, N2 stepper pill semantics, N3 `CardTitle` level prop, N4 `LEVEL_HINTS` duplication.

### M8 — Admin Design System Polish (2026-06-19) ✅ SHIPPED — committed a631aa9
- **New**: `src/components/ConfirmAction.tsx` (`"use client"`) — shared `role="alertdialog"` confirm panel; focus→Cancel on open; Escape closes+returns focus to trigger; `aria-expanded`/`aria-busy`; `loading`/`disabled`/`disabledTitle` props.
- **`CardTitle level` prop** (N3 from M7): `"h2"|"h3"|"h4"` default `"h3"` — non-breaking; `CardTitleProps` re-exported.
- **3 action components refactored**: `AdminArticleActions` (2 ConfirmAction instances), `AdminMemberActions` (M1 Select + ConfirmAction, `isSelf` self-protection preserved), `AdminTagActions` (Fragment + ConfirmAction). Playwright selectors `.admin-actions`/`.admin-actions-row`/`.admin-confirm` intact.
- **AdminNav**: indigo pill active (`border-primary text-primary-text color-mix(primary 8%)`); inactive `buttonVariants({ghost,sm})`; layout header inline flex.
- **5 admin pages**: M1 Card/Badge/CefrBadge/Input/Select/Button throughout; `tabIndex={0}`+`aria-label` on scrollable table wrappers.
- **globals.css**: all admin hardcoded hex removed; retired classes `/* retired — M8 */`; new `tr:hover td` indigo color-mix.
- Notable: Select `w-full` fix (wrap in `<div className="w-auto">`); `var(--accent)` → `var(--primary)` in `.admin-bar-fill` (same value, explicit token).
- Rusty APPROVE (clean); Basher PASS. 41 routes · 153/153 tests.

### M9 — Command Palette + Final A11y/Motion QA (2026-06-19) ✅ SHIPPED — committed dff6c1f
**Pass A — Command palette**: 5 new files (`CommandPalette.tsx`, `CommandPaletteProvider.tsx`, `command-items.ts`, `useArticleSearch.ts`, `HeaderSearch.tsx`). Combobox+listbox ARIA (focus stays on input; `aria-activedescendant` drives highlight); grouped results Pages→Actions→Articles; Search→Spinner slot swap in input; stale-closure-safe via `selectableItemsRef`/`activeIndexRef`; `latestQueryRef` in `search()`; platform detection for ⌘K/Ctrl+K kbd chip; global `:focus-visible` ring (`:where(...)` zero-specificity, `@layer base`). Reduced-motion: `animation:none; opacity:1; transform:none` (identity) for all palette animations.
**Pass B — 15-nit sweep**: NIR-M5-1 `isMobile` state gates PanelContents to one slot + split `asideTabListRef`/`sheetTabListRef`; NIR-M5-2 `closeButtonRef` focus on sheet open + `getFocusable` Tab-trap + `fabRef` restore on close; M6 `extendedToday` real value wired; M6 `StudyPageShell` lifts `reviewing` bool (`inert+aria-hidden+opacity-60` on StudyList); M6 `GoalMetIcon` client component suppresses SSR flash; M7 N1 `onBlur` clamp; M7 N2 `<nav><ol>` stepper; M7 N4 `LEVEL_HINTS` exported from `profile.ts`; M8 N1 `ConfirmAction` controlled mode + `AdminArticleActions` mutual exclusion; M8 N2 `statusBadgeVariant()` in `admin.ts`; M8 N3 `useId()` `aria-describedby` on alertdialog; M8 N4 `.admin-actions min-width:220px` restored; M1 N3 Spinner `stroke="var(--border)"`; M2 N3 `aria-label` removed from `role="menu"` div.
**Pre-land fixes**: FIX-1 `aria-expanded={true}` on combobox (was `selectableItems.length > 0`); FIX-2 `loadMore` stale-response guard (mirrors `search()` pattern). All 15 nits PASS; palette PASS; regression PASS. **Completes redesign roadmap M4–M9.**

### M10 — Bookmarks & Reading Lists (2026-06-19) ✅ SHIPPED — committed c676921
Built the full M10 UI. Key structural challenge solved: `CardBookmarkButton` as sibling of `<Link>` (never nested inside) via wrapper-div refactor of `ArticleCardView`; all 5 `ListingProgressSync` DOM hooks verbatim unchanged.
- **`ReaderBookmarkCluster`**: split-pill in `.reader-meta` `ml-auto`; Segment A `aria-pressed` toggle (optimistic + revert, `rw-pop`, `role="status"` error live region); Segment B `ListPlus` icon, `aria-haspopup="dialog"`, dot indicator when in any named list.
- **`CardBookmarkButton`**: absolute-positioned overlay (`js-bookmark`, `data-saved`); `[data-card-wrapper][data-article-id]` wrapper div; Link keeps its `data-article-id` — both sync hooks work.
- **`ListingBookmarkSync`**: reads `readwise:bookmark-changes` sessionStorage; calls `POST /api/saved`; sets `data-saved` + `aria-pressed` in DOM (parallel to `ListingProgressSync`).
- **`ListPickerPopover`**: `role="dialog"`, membership checkboxes, inline list creation, `useRef` guard on `onMembershipLoaded`, Escape + outside-click close.
- **`ListSwitcher`**: desktop sidebar + mobile snap-scroll pill bar; inline create/rename/delete; `ConfirmAction` reused for delete.
- **`/lists` page**: `requireSession("/lists")`; `?list=<id>`; SSR via `getUserLists`+`getListWithArticles`+`getProgressMap`+`getBookmarkedArticleIds`; `EmptyState`.
- **Nav**: "Saved" (Bookmark icon) added between Browse and Study in `PRIMARY_NAV`.
- **Middleware**: `/lists` in `PROTECTED_PREFIXES` + both `config.matcher` entries.
- **CSS**: additive M10 section; card-removal fade; `.lists-layout`/`.lists-sidebar`/`.lists-mobile-bar` (900px breakpoint).
Rusty APPROVE-WITH-NITS (no IDOR, 6 deferrable nits N1–N6). Basher PASS 57/57 checks, IDOR clean. 191/191 tests pass.

### M11 — Highlights & Notes (2026-06-19) ✅ SHIPPED — committed 1e69c01
Built M11 UI. Key architectural work: `OpenSurface = "dictionary" | "toolbar" | "popover" | null` state machine in `WordLookup.tsx`; single `handleSelect` branches (collapsed → dictionary, click-on-mark → popover, drag-select → toolbar) — mutual exclusion by construction, no second listener. `applyHighlightMarks`: TreeWalker collects text nodes in sanitized prose, segments by highlight offsets, applies in reverse document order via `splitText` + `insertBefore` (no `innerHTML`). Re-anchor: `computeAnchor` (offset-first) → `findBestAnchor` (prefix/suffix fallback) → orphaned indicator. Pre-land fixes: **F1** crash-guard (`if (seg.from > tn.length) continue` + clamp) for overlapping DB highlights; **F2** `useEffect` dep array `[anchorEl]` on positioning effect. New files: `ReaderHighlightsProvider` (optimistic CRUD, aria-live, overlap→keep-earliest+toast, localStorage last-used color), `SelectionToolbar` (pill, 4 swatches radiogroup, Define conditional), `HighlightEditPopover` (color+note+ConfirmAction delete, `role="dialog"`), `ReaderNotesPanel` (5th tab, inline NoteEditor, flashAndScroll, orphaned indicator, EmptyState). Modified: `tokens.css` (`--hl-*` ×12), `globals.css` (mark/toolbar/popover/note CSS + flash keyframes), `ReaderToolsPanel` (5th tab always-mounted), `reader/[id]/page.tsx` (wrapped in Provider + articleId prop). Rusty APPROVE-WITH-NITS (no XSS/IDOR; 5 deferrable nits). Basher PASS all browser checks.

### M12 — AI Tutor UI (2026-06-19) ✅ SHIPPED — committed 96ab8d0
Built M12 UI. New `src/lib/tutor-markdown.ts` — pure TypeScript XSS-safe tokenizer (bold/italic/code/headers/links → React-renderable plain token objects; no JSX, no HTML output; 25 unit tests covering XSS payloads + tokenizer correctness). `ReaderTutorProvider.tsx` (`"use client"` context: GET history on mount, append user+assistant messages on send, clear action via DELETE). `ArticleTutor.tsx` — chat panel: scrollable `role="log"` message list with per-message timestamps, composer textarea + send button, Saul-worded starter chips (5 CEFR-level-tailored suggested questions), graceful-unavailable state (renders correctly on `fallback:true`), Clear button (min-width D2). `ReaderToolsPanel.tsx` modified — 6th "Ask" tab (Sparkles icon, lazy-mount guard `visited.has("ask")`). `globals.css` additive `.rw-tutor*` section. Pre-land: F1 (Rusty — `@media (prefers-reduced-motion)` class typo `rw-tutor-typing-label` → `rw-tutor-thinking-label`), D1 (Basher — composer autofocus on panel open), D2 (Basher — Clear button min-width). Rusty APPROVE-WITH-NITS (no XSS/IDOR). Basher PASS 267/267 tests (25 new tutor-markdown unit + 23 route/lib).
