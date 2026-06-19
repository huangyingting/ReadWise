# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader. Articles are scraped from the internet; goal is a redesign into a modern, attractive, feature-rich website.
- **Stack:** Next.js 15 (App Router, TypeScript), React 19, Prisma + SQLite, NextAuth v4 (database sessions), Azure OpenAI / Azure Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### M2 — Global App Shell (2026-06-19) ✅ SHIPPED — committed 385de06
Route group `src/app/(app)/` pattern confirmed: URL-transparent, zero middleware churn, single layout ownership. Admin untouched (own layout). Root layout untouched (fonts + no-flash + Providers). Nit N1 resolved: Admin link belongs in UserMenu/MobileDrawer (not AppNav) per Saul's finalized spec.

### Redesign continuation session (2026-06-19T11:32:57+08:00)
Spawned by Scribe: produce redesign roadmap proposal (product-page migration to design system + curated rich-features menu) at `.squad/decisions/inbox/rusty-redesign-roadmap.md`. Context: M3 built by Linus, awaiting Basher verify; M4–M8 outstanding.

### Accepted Roadmap M4–M9 (2026-06-19) — ACCEPTED by Yingting
Roadmap proposal accepted. Key decisions recorded: M4–M9 (renamed/expanded from M4–M8; added new M7 "Onboarding, Auth & Settings polish"); migration-first sequencing; additive-migrations-only rule for all net-new features. Roadmap supersedes earlier M4–M8 sketch in decisions.md. Rich-features menu archived with the proposal.

### M4 — Code Review (2026-06-19) ✅ APPROVE-WITH-NITS — committed 7e554c9
Reviewed M4 working tree (linus-m4-built.md + livingston-m4-search.md). APPROVE-WITH-NITS verdict — no blockers:
- All five must-not-break constraints passed (ListingProgressSync hooks, no raw hex, no nested anchors, Prisma schema unchanged, US-030 cache tags unaffected).
- **NIR-1:** `listInProgressArticles` published filter runs JS-side after `take`; should be in Prisma `where` (take may under-fill rail when unpublished rows exist).
- **NIR-2:** `--experimental-strip-types` absent from CLI scripts (`npm run scrape|process|worker|seed`) — works today but asymmetric with test script.
- **NIR-3:** Duplicate `role="region"` landmark on continue-reading rail (`<section aria-label>` + inner `<div role="region">`).
- **NIR-4:** Two separate `@/lib/cn` imports in `CategoryBrowser.tsx`.
Linus nit-cleanup in progress.

### M5 — Reader Redesign Code Review (2026-06-19) ✅ APPROVE-WITH-NITS — committed f199596
Reviewed M5 working tree (linus-m5-built.md). APPROVE-WITH-NITS verdict — no blockers. All six review scopes passed: audio context architecture, tabbed panel mount-preservation, AI panel refactors, reader-prefs + no-flash, reading-mode scope, must-not-break. Key findings: `useCallback([words])` is stale-closure-free ✅; `hidden` attribute panel lifecycle correct ✅; `data-reading-mode` correctly reader-scoped, never touches `<html>` ✅; `sanitizeArticleHtml`→`WordLookup` sole HTML path ✅. Four nits: NIR-M5-1 (double mobile PanelContents → M6), NIR-M5-2 (firstFocusRef unassigned, focus-move missing → M9), NIR-M5-3 (missing `<main>` landmark — fix-before-land, FIXED by Linus), NIR-M5-4 (dead isMounted ref — FIXED by Linus). M5 LANDED f199596.

### M6 — Dashboard & Study Gamification Code Review (2026-06-19) ✅ APPROVE-WITH-NITS — committed 1beea38
Reviewed M6 working tree. APPROVE-WITH-NITS verdict — no blockers. All 8 review scopes passed: migration (purely additive), SM-2 engine (EF floor, grade semantics, no NaN/negative intervals), activity/streak (UTC midnight anchor, idempotency, longestStreak scan correct), flashcard ownership guard (loads card → userId check → ApiError 404), tests (meaningful coverage of all grades, streak anchors, ownership paths), UI wiring (appStateRef stale-closure guard, double-grade prevention, server-side `getStreakSummary` in Promise.all), accent rule + a11y (teal only on reading-state, indigo on interactive, aria-live, keyboard, reduced-motion), regression safety (M4/M5 untouched). Two FIX-BEFORE-LAND: F1 srs.ts doc-comment (Livingston) — 1.2× → 0.6× correction; F2 hoverStyle dead code (Linus) — destructure + apply inline style. Seven deferrable nits (D1–D5 carry to M7, N4 → M9 a11y, N5 trivial type widening). Both fixes applied and verified; M6 LANDED 1beea38.

### M7 — Onboarding / Auth / Settings Code Review (2026-06-19) ✅ APPROVE — committed cb204c5
Reviewed M7 working tree (Livingston backend + Linus UI). Clean **APPROVE** — no blockers, no FIX-BEFORE-LAND items. All 13 review scopes passed: auth flow (`signIn`/`callbackUrl` guard/`?error=` mapping unchanged), onboarding data parity (POST body byte-identical; `englishLevel` gate double-guarded; `completedAt` server-side), gating unchanged (middleware untouched; `requireSession`/`requireOnboardedSession` unchanged), `parseProfileInput` + daily-goal (constants exported, hard-reject, omit-preserves, conditional spread, 9 new tests), settings wiring (page reads `??DAILY_GOAL_DEFAULT`; form sends `dailyGoal`; stepper clamps correctly), M1 primitives/tokens (no raw colors introduced), accent rule, a11y focus management, a11y radio-cards, a11y chips, a11y stepper progress, a11y heading order, a11y daily-goal stepper, a11y error/success, `globals.css` additive, reduced-motion, M4/M5/M6 untouched, no schema/migration changes. Four deferrable nits → M9/M8: N1 `onBlur` clamp, N2 stepper pill semantics, N3 `CardTitle` level prop, N4 `LEVEL_HINTS` duplication. M7 LANDED cb204c5.