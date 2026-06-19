# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
OPT-A resolved FINAL: `--accent` stays indigo. `--bg-accent: var(--teal)` / `--text-accent: var(--teal-text)` aliases added in tokens.css. Indigo = interactive; teal = reading-state (active nav underline, progress bars, CEFR badges). Nit N2: AppFooter correctly client (usePathname); Saul's "server" label in impl checklist was stale.
- Delivered the full Studio token spec: Inter/Space Grotesk/Literata font trio, 35 semantic color tokens (light+dark, WCAG AA verified), type/spacing/radii/shadow/motion scales, per-primitive visual specs. All values wired by Linus exactly as specced.
- **Pending at M2 kickoff (OPT-A):** `--accent` CSS var was kept as indigo (`var(--primary)`) for legacy continuity; Saul's teal exposed as `--teal*` tokens + Tailwind `accent` utility for new components. Confirm or flip at M2 kickoff before teal is used in new components.
- **Pending at M2 kickoff (N5):** Linus added `--text-inverted: var(--bg)` (not in Saul's original table). Confirm this is the right value.

### M3 — Landing Page Redesign (Studio) (2026-06-19) — SHIPPED (committed 2824eea)
Delivered the M3 UX spec and design direction for the landing page: auth-aware hero, 6-section layout (Marketing Header, Hero, Features, How It Works, Social Proof, Final CTA Band), Wordmark/MockReaderCard/FeatureCard/StepCard/Reveal component specs, `text-gradient-brand` + `rw-fade-up` motion spec. Basher PASS (30/30 checks). Committed 2824eea. Non-blocking D3 follow-up: CTA band `Button variant="secondary"` in dark theme — dark surface on gradient (14:1 WCAG AAA ✓); awaiting Saul sign-off before M9 polish pass.

### M4 — Listings & Discovery (2026-06-19) ✅ SHIPPED — committed 7e554c9
Delivered the full M4 UX spec (`saul-m4-listings.md`): redesigned `ArticleCardView` anatomy (CefrBadge top-left, byline, teal progress fill, done-chip "Read", hover/focus lift `-translate-y-0.5`+`shadow-md`+indigo title, `variant="grid"|"rail"` prop); §2.1 responsive grid (1/2/3-col, `listing-container` 1200px max-width); continue-reading rail spec (snap-scroll, `role="region"`, `tabIndex=0`); `EmptyState` and `SkeletonCard`/`SkeletonCardGrid` component specs; `CategoryBrowser` tab-bar (indigo active, NOT teal — accent rule upheld); dashboard/browse/tags/reader-related migration targets. ListingProgressSync DOM contract documented as sacred (5 hooks, zero renames). Linus built exactly to spec; Rusty APPROVE-WITH-NITS; Basher PASS (121 checks).

### M5 — Reader Redesign (2026-06-19) ✅ SHIPPED — committed f199596
Delivered the M5 "Crown Jewel" UX spec: two-column reader layout (66ch prose / Literata, sticky tools rail ≥1100px, mobile FAB + bottom-sheet); `ReaderControls` (5-step font-scale stepper + Light/Sepia/Dark segmented radio); reading-mode token architecture (sepia 8 WCAG-verified hex values, `data-reading-mode` reader-scoped); tabbed AI panel (Listen/Words/Quiz/Translate, stay-mounted via `hidden`, lazy-load guard); shared audio context + `ReaderMiniPlayer` (Play/Pause, skip ±10s, seek, speed, close). Coordinator incorporated three open decisions: default reading mode = resolved global theme; mini-player includes skip ±10s + close; hero bleed to `min(100%,760px)`. Linus built exactly to spec; Rusty APPROVE-WITH-NITS (4 nits — NIR-M5-3/4 fixed pre-land; NIR-M5-1/2 deferred M6/M9); Basher PASS (77 checks, AI configured) after fixing D5 (no-flash script position).

### M6 — Dashboard & Study Gamification (2026-06-19) ✅ SHIPPED — committed 1beea38
Delivered the M6 light-gamification UX spec: `StreakWidget` anatomy (teal flame 28px, 10px dot row with today ring, `Award` longest-streak sub-stat, zero-streak state); `DailyGoal` SVG ring (72×72, teal→success, `role="progressbar"`, `rw-pop` on Check, "Adjust goal" → `/settings`); `FlashcardReview` state machine (idle→loading→session→complete, 3D flip card, 4 indigo-anchored grade buttons, keyboard Space/Enter/1–4/Esc, `aria-live`). Accent-rule adjudication: streak/goal = reading-state → teal legitimate; grade buttons = interactive → indigo. Coordinator decisions incorporated: light-only gamification, Good = solid indigo, daily-goal editing deferred M7, `extendedToday` flame-flicker deferred M7. Linus built to spec (F2 hoverStyle fix applied); Rusty APPROVE-WITH-NITS; Basher PASS (87 checks). Deferred to M7: D1 extendedToday flame pulse, D2 StudyList dimming, D3 rw-pop reactive, D4 daily-goal editing.
