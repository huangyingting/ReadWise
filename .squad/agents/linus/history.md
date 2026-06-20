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

### M6–M9 Summary (2026-06-19) [condensed]

**M6 — Dashboard & Study Gamification** ✅ committed 1beea38 — `StreakWidget` (teal flame, dot row, longest-streak), `DailyGoal` (72×72 SVG ring, `rw-pop`), `FlashcardReview` (3D flip, 4 grade buttons, keyboard Space/Enter/1–4/Esc, `aria-live`). Dashboard wiring via `Promise.all`; study page wiring; CSS: `rw-flame-flicker`, `rw-pop`, `.rw-flip*`; `prefers-reduced-motion` fallback. Deferred to M7: extendedToday flame, StudyList dimming, daily-goal editing.

**M7 — Onboarding / Auth / Settings Polish + Daily-Goal** ✅ committed cb204c5 — Sign-in `<Card>` with Wordmark + ThemeToggle + `rw-fade-up`; 4-step onboarding wizard (`key={step}` remount + heading focus, `CefrBadge` radio-cards, chip grid `aria-pressed`, review step with Edit-jump buttons); Settings 3-card layout with `−/input/+` daily-goal stepper (`DAILY_GOAL_MIN=1`, `DAILY_GOAL_MAX=10`). `rw-step` CSS utility additive.

**M8 — Admin Design System Polish** ✅ committed a631aa9 — `ConfirmAction.tsx` (`"use client"`, `role="alertdialog"`, cancel-first focus, Escape restore, `aria-expanded`/`aria-busy`). `CardTitle level` prop (`"h2"|"h3"|"h4"`, non-breaking). 3 action components refactored to use `ConfirmAction`. AdminNav indigo pill active style. All 5 admin pages with M1 primitives; scrollable table wrappers with `tabIndex`+`aria-label`. `globals.css`: hardcoded hex removed, retired classes commented.

**M9 — Command Palette + Final A11y/Motion QA** ✅ committed dff6c1f — 5 new files: `CommandPalette.tsx` (combobox+listbox ARIA, `aria-activedescendant`, grouped results Pages→Actions→Articles, platform ⌘K/Ctrl+K), `CommandPaletteProvider`, `command-items.ts`, `useArticleSearch.ts` (stale-closure-safe `latestQueryRef`), `HeaderSearch.tsx` (desktop faux box + mobile icon). Global `:focus-visible` ring (`:where(...)` zero-specificity). 15-nit Pass B sweep: mobile tab-trap, NIR-M5-1/2, M6 nits, M7 N1/N2/N4, M8 N1–N4, M1/M2 nits. Reduced-motion: identity transforms (not duration-0). **Completes redesign roadmap M4–M9.**

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

### M13 — Sentence-level Translation UI (2026-06-19) ✅ SHIPPED — committed 47f7aa6
Added `"translate"` to `OpenSurface` state machine; `handleTranslate` transitions `toolbar→translate` without `closeAll` (preserves `savedAnchorRef`). New files: `src/lib/translate-lang.ts` (shared `TRANSLATE_LANG_KEY`/`TRANSLATE_LANG_DEFAULT="zh-Hans"`/`getTranslateLang()`/`setTranslateLang()` with SSR guards); `src/components/SentenceTranslatePopover.tsx` (fixed-position; clamp+flip; 4 states: shimmer `prefers-reduced-motion`-gated / result `lang`+`dir="auto"` RTL / fallback calm note / error `role="alert"`; React `<p>` text nodes only). Modified: `SelectionToolbar` (Translate button Languages icon, order: Highlight·Translate·Add note·Define); `WordLookup` (`runSentenceTranslate` + `translateReqRef` stale guard; `closeAll` retains `translateLang`; outside-click exempts `translatePopoverRef`); `ArticleTranslation` (seeds from + writes to shared lang key); `globals.css` (`.rw-tr-*` family ~160 lines, additive). **M11 latent fix (Basher found):** `useMemo(() => ({ __html: html }), [html])` — React 19 reference equality: inline object reset `innerHTML` on every render, wiping `<mark>` nodes. Rusty APPROVE-WITH-NITS; Basher PASS 28/28 browser tests. npm test 281/281. 4 deferred nits: N1 lang seed validation, N2 client char guard, N3 toolbar order vs spec diagram, N4 redundant stopPropagation.

### M14 — Quiz Mastery & History UI (2026-06-19) ✅ SHIPPED — committed 01380fc
`ArticleQuiz.tsx`: `recordedRef = useRef(false)` guard (set synchronously before fetch; reset in `handleRetry`; POST failure → `setSavedNote("failed")` without ref reset; grading logic UNCHANGED). Enriched result block: this-attempt score + article best + `Sparkline` mini-history. `isNewBest` derived client-side (`priorBest` captured before state update; equal score = not new best). New `Sparkline.tsx`: reusable SVG polyline, `<figure className="rw-spark">`, `<svg aria-hidden="true">` + `<span className="sr-only">` label (scores + trend direction). New `MasteryWidget.tsx`: server component; average-score ring `role="img" aria-label`; dashboard `Promise.all`; `md:col-span-2 lg:col-span-1`. `/study` Comprehension section. CSS: additive `.rw-spark*`/`.rw-mastery*` in globals.css. npm test 300/300; typecheck 0; lint 0. Rusty APPROVE-WITH-NITS; Basher PASS 38/38. 2 deferred nits: N1 "Try again" btn-primary; N2 unused `active` prop.
