# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with Studio redesign and rich reader features.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-20 after the history-size gate. Full QA detail remains in session/orchestration logs and issue/PR records. -->

### 2026-06-19 — Redesign roadmap M2–M9 QA

Basher verified the Studio redesign milestones with Playwright/Chromium 1228 and static gates. The cumulative redesign passed typecheck, lint, and production build across the milestone sequence.

- **M2 App Shell:** conditional pass became pass after inactive nav link CSS fix; remaining user-menu aria-label deferred to M8.
- **M3 Landing:** marketing page checks passed; one accepted CTA-band dark-gradient observation.
- **M4 Listings:** 121 checks passed; preserved `ArticleCardView`, `ListingProgressSync`, `data-article-id`, and progress DOM hooks.
- **M5 Reader:** 77 checks passed with AI configured; no-flash script placement fixed; TTS, word highlight, reading modes, mini player, and lookup verified.
- **M6 Gamification:** 87 checks passed; streak, daily goal, flashcard review, keyboard grading, aria-live, and SRS API verified.
- **M7 Onboarding/Goal:** 73 checks passed; wizard gate, aria-current/live, goal clamping, reduced motion, and save confirmation verified.
- **M8 Admin/UI:** admin nav, `ConfirmAction`, dark-token audit, and heading levels verified.
- **M9 Command palette/final sweep:** palette semantics, mobile sheet, reduced-motion elements, and M4–M9 regression passed.

### 2026-06-19 — Rich feature QA M10–M16

Basher verified all rich reader features with browser, static, security, and regression checks:

- **M10 Bookmarks/Lists:** PASS, 57/57 checks. Confirmed auth gating, reader/card bookmark behavior, `/lists`, mobile/dark states, listing progress hooks, and cross-user IDOR responses returning 404.
- **M11 Highlights/Notes:** PASS. Confirmed selection coexistence, four highlight colors, persistence/reanchor, edit/delete panel, notes panel, XSS-safe React text, IDOR isolation, mobile/a11y, and reader regression safety.
- **M12 AI Tutor:** conditional pass to pass after autofocus and clear-button width fixes. Verified real Azure response/fallback, grounded chat UI, clear history, XSS-safe token rendering, and user-scoped clearing.
- **M13 Sentence Translation:** conditional pass to pass after the React 19 mark-wipe fix (`useMemo` for `dangerouslySetInnerHTML` object). Verified toolbar/popover, language sharing, RTL, fallback/network states, no highlight side effects, a11y, mobile, and reduced motion.
- **M14 Quiz Mastery:** PASS. Verified record-once attempt behavior, best/history/mastery UI, IDOR clean routes, Sparkline accessibility, and dashboard layout.
- **M15 Personalized Feed:** PASS. Verified scoring constants, completed-article exclusion, diversity, uncached API, card DOM contracts, why chips, load more, cold-start/end states, and 401 auth behavior.
- **M16 Pronunciation:** conditional pass to pass after legend swatch CSS fix. Verified score/sub-bars, per-word non-color cues, Azure token response excluding the raw key, cross-user 404, unavailable/mic-denied/transient retry states.

### 2026-06-20 — Review and QA lessons

- When #48 double-render is present, automated DOM/browser findings can be artifacts. Cross-check high-severity reader issues against source and manual root-cause behavior before escalating.
- The dev-browser CLI is effective headless for broad DOM QA. Screenshot capture can stall while fonts load; wrap screenshots in try/catch and avoid blocking DOM-based verification on nonessential screenshots.
- Preserve established browser contracts during redesign and feature QA: listing progress hooks, card wrapper/article IDs, bookmark hooks, reader surface state machine, auth gates, and IDOR behavior.


### 2026-06-21 — End-user review triage lesson

During review 3, distinguish dev-data artifacts and expected graceful-fallback states from true product bugs before flagging High. Placeholder seed article bodies were not filed as a content bug, while the AI Tutor failure was escalated because translation worked in the same environment and the tutor path returned null.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-25 — Codebase Quality Audit (10-pass TESTING sweep)

Basher performed an exhaustive 10-pass testing audit of ReadWise as part of a five-domain quality review requested by Yingting Huang. Findings documented in `files/findings-testing.md` (16 findings: TEST-1–TEST-16).

Key testing findings: shared test helper adoption gaps with mock factories duplicated across test files, missing coverage for auth boundary conditions, large test files (>500 lines) mixing unit and integration concerns, duplicated prisma mock setup across 20+ test files, missing shared fixtures for article/user/organization entities, inconsistent assertion patterns, outdated jest.mock patterns superseded by newer factory helpers, E2E coverage gaps on worker/background job paths, missing IDOR regression tests for multi-tenancy routes, inconsistent test data builders.

After Rusty-1 (opus-4.8) consolidation of all 79 cross-domain findings into 15 issues: **Basher owns issues #614** (test shared-helper adoption — Phase 1), **#618** (test file splitting and coverage gaps — Phase 2), **#625** (outdated test patterns cleanup — Phase 3) on epic #610.

Epic #610 + child issues #611–#625 created on huangyingting/ReadWise. No source code modified (analysis only).

## 2026-06-26 — Round-2 Codebase Quality Audit (10-pass TESTING sweep)

Basher-1 performed a second-wave 10-pass testing audit as a follow-up to epic #610, targeting NEW, non-overlapping issues. Read `files/findings-testing.md` and issues #611–#625 first. Focused on snapshot test drift, multi-tenancy integration coverage gaps, Playwright test isolation, error-handling branch coverage, and absence of contract/schema tests. Findings documented in `files/findings-testing-r2.md` (15 findings: TEST2-1–TEST2-15).

After Rusty-3 (opus-4.8) consolidation of all 67 round-2 findings into 13 issues: **Basher owns issues #636** (Playwright test isolation and snapshot drift remediation, Phase 2), **#637** (multi-tenancy integration test coverage, Phase 2), and **#639** (contract/schema tests and error-branch coverage, Phase 3) on epic #626, follow-up to #610.

No source code modified (analysis only).


## 2026-06-29 — Image-credit filter QA

Basher reviewed Livingston's scraper image-credit filtering diff and approved it. Targeted `tests/scraper-declutter.test.ts` passed with 36 passed / 0 failed and no concerns were reported.


## 2026-06-29T02:39:40.222+00:00 — Smithsonian scrape workflow QA
Reviewed and approved Livingston's Smithsonian scrape workflow. Focused tests passed 92/92; help plus analyze-only commands exited 0 against 50 DB articles; `git diff --check` was clean. Note retained: prefer counts/URLs over snippets if analysis stdout is retained.


## 2026-06-29T03:14:57.986+00:00 — Byline/date scraper cleanup QA
Reviewed Livingston's scraper body cleanup and approved. Targeted tests passed 55/55, broader scraper tests passed 319/319, and typecheck passed; retained the minor note that date removal follows exact/`By` author lines rather than every prefixed byline variant.


## 2026-06-29T03:36:59.547+00:00 — Smithsonian publish workflow QA
Basher reviewed and approved the Smithsonian reset/scrape/publish workflow. Analyze-only reported 50 DB rows and no recurring noise; DB counts were total=50, published=50, drafts=0, missingPublishedAt=0; visited records had only URL/timestamp/outcome fields; targeted scraper/provider tests passed 115/115; typecheck passed.


## 2026-06-29T04:06:47.026+00:00 — Smithsonian visible byline/avatar QA
Reviewed Livingston's fix for article `cmqyo77ig000zjgg7ces1fu51` and approved. Diff review covered scraper declutter/extract changes and related Smithsonian tests/provider changes. DB pattern checks on `prisma/dev.db` confirmed target metadata preserved (`author='Greg Daugherty'`, `publishedAt=2026-06-24T11:45:00Z`) with `img_tags=10`, `non_headshot_img_tags=10`, `headshot=0`, `byline_role=0`, `standalone_date_tags=0`. Focused scraper/provider/image tests passed 123/123, `git diff --check` passed, and `npm run typecheck -- --pretty false` passed. No blockers.


## 2026-06-29T03:56:04.101+00:00 — Smithsonian avatar cleanup QA

Reviewed and approved Livingston's Smithsonian cleanup. Confirmed target metadata author/publishedAt was preserved, 10 non-headshot images remained, headshot/byline/date residue counts were 0, diff check passed, focused scraper/provider/image tests passed 123/123, and typecheck passed.


## 2026-06-29T04:22:21.322+00:00 — Smithsonian scrape QA approval

Basher reviewed and approved the completed Smithsonian scrape/publish workflow. QA verified 342 total Smithsonian rows, all published/`PUBLIC`/ownerless with no drafts or missing `publishedAt`; 595 unique visited URLs with URL/timestamp/outcome-only records; dry discovery fresh=0/skippedVisited=595; analyze-only no recurring noise; focused Smithsonian tests 65/65; changed-file ESLint, diff check, and typecheck passed.


### 2026-06-29T05:27:54.043+00:00 — Undark scrape QA approved

Reviewed Livingston's Undark scrape/cleanup work and approved it as scoped. Confirmed 10/10 Undark rows are DRAFT with 0 duplicate source URLs, known support/newsletter noise count is 0, Smithsonian remains 392/392 DRAFT, focused tests report 63 passed, and lint/typecheck passed.
