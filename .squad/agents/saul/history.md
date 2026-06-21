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
