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
