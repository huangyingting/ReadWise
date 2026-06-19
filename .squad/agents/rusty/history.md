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