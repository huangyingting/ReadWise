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
| **M6** | Dashboard & Study — reading streaks/daily goal, flashcard SRS over existing `SavedWord` | Livingston (data), Linus (UI), Saul (spec) | L | Pending |
| **M7** | Onboarding, Auth & Settings polish | Saul (spec), Linus (build) | S–M | Pending |
| **M8** | Admin polish — design system to `/admin`; extract shared `ConfirmAction` | Linus (build), Saul (light spec) | M | Pending |
| **M9** | Motion, a11y, responsive QA + ⌘K command palette (reuses M4 search endpoint). Closes M1/M2 nits N2/N3/N4. | Basher (lead QA), Linus, Livingston | M | Pending |

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
