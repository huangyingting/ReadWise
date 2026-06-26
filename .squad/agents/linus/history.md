# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with a modern Studio redesign.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-20 after history exceeded the 15KB summarization gate. Full milestone details remain in decisions.md and session/orchestration logs. -->

### 2026-06-19 — Studio redesign UI milestones M1–M9

Linus delivered major frontend portions of the Studio redesign:

- **M1 Design System:** Tailwind v4 CSS-first tokens in `src/app/tokens.css`, light/dark/system theme support, and shared UI primitives (`Button`, `Card`, `Input`, `Select`, `Field`, badges, skeleton/spinner). `--accent` stayed indigo for legacy continuity while teal became the reading/progress accent.
- **M2 App Shell:** URL-transparent `(app)` route group, sticky header, nav, user menu, mobile drawer, theme toggle, and footer hiding on immersive reader/settings surfaces.
- **M3 Landing:** Auth-aware marketing page using shared buttons, reveal motion, and reduced-motion safeguards.
- **M4 Listings:** `ArticleCardView` variants, responsive grids, progress rail, empty/skeleton states. Sacred contract: preserve the five listing progress DOM hooks and `data-article-id`.
- **M5 Reader:** Two-column reader, sticky tools rail/mobile sheet, scoped reading modes, `ReaderAudioProvider`, mini player, and lazy mounted AI tabs.
- **M6–M9 UI:** Streak/daily-goal/flashcard UI, polished onboarding/auth/settings, admin primitives, `ConfirmAction`, command palette, global focus-visible pass, and reduced-motion fixes.

### 2026-06-19 — Rich reader/features M10–M16

Linus implemented the frontend for the post-redesign feature set:

- **M10 Bookmarks/Lists:** `ReaderBookmarkCluster`, overlay `CardBookmarkButton` sibling to `<Link>`, `ListingBookmarkSync`, `ListPickerPopover`, `/lists`, and preserved listing progress hooks.
- **M11 Highlights/Notes:** `OpenSurface` state machine, DOM-safe highlight marking via text nodes/splitText, notes panel, edit popover, overlap handling, and the React 19 `useMemo({__html})` fix to stop rerenders from wiping marks.
- **M12 AI Tutor:** Ask tab, chat UI, starter chips, clear action, graceful unavailable state, and XSS-safe rendering via token objects.
- **M13 Sentence Translation:** Selection toolbar Translate action, fixed popover, shared language preference, stale request guard, and React text rendering only.
- **M14 Quiz Mastery:** Record-once quiz completion, best score/history block, `Sparkline`, and dashboard/study mastery widgets.
- **M15 Personalized Feed:** `ForYouFeed`, quiet why-chip metadata, cold-start/end-of-feed states, and card sync contracts preserved.
- **M16 Pronunciation:** Speak tab, client-only Speech SDK loading, token retry handling, non-color word feedback, and narration reuse for “Hear it”.

### 2026-06-20 — Ralph work-all-issues frontend waves

Linus handled two waves in Ralph’s full-board cleanup:

- **Wave 1 reader/a11y bundle:** closed #48, #49, #52, #53, #55, #56, #57, #64, #65, #68, and #70. #48 was the double-render keystone that could cause misleading DOM symptoms.
- **Wave 5 frontend/admin/features:** closed #51 (admin double-render), #69 (analytics charts), and #40 (dictation mode), and fixed a pre-existing production build failure.

Final cumulative gate after all six waves: typecheck 0, lint 0, tests 411/411, build passes.

### Cross-agent lessons

- Sequential single-owner waves avoid main-branch git conflicts when agents are committing directly to `main`.
- Reader DOM symptoms should be root-caused against hydration/double-render behavior before treating them as independent Critical bugs.
- Preserve established DOM contracts (`ListingProgressSync` hooks, card bookmark hooks, reader surface state machine) before layering new UI.
- Browser-only capabilities such as dictation/Speech SDK need client-only loading, permission-aware states, and graceful unavailable paths.


### 2026-06-20 — Client/server import boundary lesson

Client (`"use client"`) components must not import `@/lib/difficulty`, `@/lib/ai`, or `@/lib/logger`, because that chain can pull Node-only `node:async_hooks` into the client bundle. Run `npm run build` from a clean `.next` state with no dev server as a hard gate before pushing client-facing changes.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- PR-body files belong in /tmp, never committed into .squad/ or the repo.
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-25 — Codebase Quality Audit (10-pass FRONTEND sweep)

Linus performed an exhaustive 10-pass frontend audit of ReadWise as part of a five-domain quality review requested by Yingting Huang. Findings documented in `files/findings-frontend.md` (16 findings: FE-1–FE-16).

Key frontend findings: oversized page and component files needing splitting, duplicated data-fetching patterns across pages, inline handler logic that should become custom hooks, redundant prop drilling patterns, dead exports and unused component variants, legacy CSS class usage (.btn, .admin-input) mixed with new token-based primitives, duplicate animation/transition logic, missing lazy boundaries on heavy reader sub-panels.

After Rusty-1 (opus-4.8) consolidation of all 79 cross-domain findings into 15 issues: **Linus owns issues #616** (hook extraction and deduplication — Phase 2), **#617** (large file splitting — Phase 2), **#624** (dead code removal — Phase 3) on epic #610.

Epic #610 + child issues #611–#625 created on huangyingting/ReadWise. No source code modified (analysis only).

## 2026-06-26 — Round-2 Codebase Quality Audit (10-pass FRONTEND sweep)

Linus-1 performed a second-wave 10-pass frontend audit as a follow-up to epic #610, targeting NEW, non-overlapping issues. Read `files/findings-frontend.md` and issues #611–#625 first. Focused on useEffect dependency arrays, Suspense/error boundaries, stale closure bugs, client/server component boundary violations, and missing loading.tsx skeletons. Findings documented in `files/findings-frontend-r2.md` (12 findings: FE2-1–FE2-12).

Standout finding: FE2-1 (flashcard useEffect with incomplete dependency arrays causing correctness bugs) became p0 issue #628.

After Rusty-3 (opus-4.8) consolidation of all 67 round-2 findings into 13 issues: **Linus owns issues #628** (p0 — flashcard effect-dependency correctness bug, Phase 1) and **#633** (Suspense boundaries, loading skeletons, and client/server boundary cleanup, Phase 2) on epic #626, follow-up to #610.

No source code modified (analysis only).
