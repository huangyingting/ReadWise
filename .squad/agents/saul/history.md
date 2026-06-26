# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with a modern Studio redesign.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-20 to keep agent histories compact. Full milestone details remain in decisions.md and session/orchestration logs. -->

### 2026-06-19 — Studio design direction and roadmap

Saul established and refined the Studio UX direction across the redesign:

- Design direction **B “Studio”**: modern learning-app aesthetic with indigo/violet primary, teal/amber accents, elevated cards, Lucide icons, and light/dark themes.
- Accent rule: indigo for interactive affordances, teal for reading/progress/learning-state feedback.
- Roadmap coverage M2–M9: app shell, listings/discovery, reader, gamification, onboarding/auth/settings, admin polish, command palette, and final a11y/motion QA.

### 2026-06-19 — Rich reader/features M10–M16 UX specs

Saul produced UI/UX specs and adjudications for the post-redesign feature set:

- **M10 Bookmarks/Lists:** bookmark affordances use indigo; list picker as dialog; `/lists` page with switcher; card overlay cannot nest inside article links.
- **M11 Highlights/Notes:** separate highlight token family, mutually exclusive gesture surfaces, toolbar/popover/notes panel anatomy, note cap, overlap behavior, and deferred global notes view.
- **M12 Tutor:** “Ask” tab, grounded chat anatomy, starter chips, graceful unavailable state, and clear-history affordance.
- **M13 Sentence Translation:** toolbar Translate action, popover states, shared language preference, calm fallback copy, and text-node-only rendering.
- **M14 Quiz Mastery:** attempt history, best score, sparkline, mastery widget, and study-page comprehension section.
- **M15 Personalized Feed:** For You feed replaces dashboard browse grid/level filter; quiet why-chip metadata; cold-start and end-of-feed states.
- **M16 Pronunciation:** Speak tab, sentence stepper, score/sub-bars, non-color per-word feedback, and narration reuse.

### 2026-06-20 — Ralph work-all-issues UX wave

Saul closed Wave 3 of Ralph’s full-board cleanup: #50, #62, #63, #66, #67, #71, #75, #76, #77, and #78. The bundle included UX polish, dead CSS removal, `.btn` to shared `Button` migration, and related user-facing cleanup.

Final cumulative gate after all six waves: typecheck 0, lint 0, tests 411/411, build passes.

### Cross-agent lessons

- Sequential single-owner waves avoid main-branch git conflicts when agents are committing directly to `main`.
- Design-system migrations should convert legacy `.btn`/ad hoc styles into shared primitives instead of adding parallel CSS.
- Dead CSS cleanup is safest when isolated in a UX wave after functional security/performance fixes have landed.
- Keep visual semantics consistent: indigo means action, teal means learning/progress state, and neutral chips explain context without competing for attention.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-25 — Codebase Quality Audit (10-pass DESIGN sweep)

Saul performed an exhaustive 10-pass design audit of ReadWise as part of a five-domain quality review requested by Yingting Huang. Findings documented in `files/findings-design.md` (14 findings: DSGN-1–DSGN-14).

Key design findings: dark-mode token coverage gaps causing WCAG contrast failures (p0), inline style overrides bypassing the design-system token layer, duplicate color/spacing definitions across globals.css and components, missing semantic token aliases for interactive states, inconsistent icon sizing, card/surface elevation mismatch, redundant className patterns, accessibility gaps on custom components.

After Rusty-1 (opus-4.8) consolidation of all 79 cross-domain findings into 15 issues: **Saul owns issues #611** (p0 dark-mode/WCAG — Phase 1), **#615** (token rationalization — Phase 2), **#623** (CSS deduplication — Phase 3) on epic #610.

Epic #610 + child issues #611–#625 created on huangyingting/ReadWise. No source code modified (analysis only).

## 2026-06-26 — Round-2 Codebase Quality Audit (10-pass DESIGN sweep)

Saul-1 performed a second-wave 10-pass design/UX audit as a follow-up to epic #610, targeting NEW, non-overlapping issues. Read `files/findings-design.md` and issues #611–#625 first. Focused on motion token system, responsive breakpoint consistency, form validation UX, loading/empty state design language, and cross-component spacing rhythm. Findings documented in `files/findings-design-r2.md` (14 findings: DSGN2-1–DSGN2-14).

After Rusty-3 (opus-4.8) consolidation of all 67 round-2 findings into 13 issues: **Saul owns issues #630** (motion token system and animation consistency, Phase 1) and **#631** (form validation UX and empty/loading state design language, Phase 1) on epic #626, follow-up to #610.

No source code modified (analysis only).
