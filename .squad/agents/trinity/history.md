# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.


- 2026-07-01T20:03:33.362+00:00 — Frontend/UI coverage work completed with assigned frontend files at 100% targeted coverage; final coverage/typecheck/lint validation passed.
- 2026-07-01T23:11:49.008+00:00 — UI catchall split decision was archived into decisions.md; hook/helper regrouping history is now captured for future UI test work.

- 2026-07-02T00:30:07.481+00:00 — PR #874 moved reader UI components into `src/components/reader` and `src/components/reader/wordLookup` without compatibility shims; imports/docs/ESLint updated and typecheck/lint passed.

- 2026-07-05T22:05:44.651+00:00 — Updated the admin AI ops UI audit expectation to `Total tokens`; targeted admin-ai-ops Playwright audit passed.
- 2026-07-05T23:02:20.863+00:00 — Split the 500-case UI audit into semantic subsystem Playwright specs with shared support in `e2e/support/ui-audit.ts`; the canonical selector is now `@ui-audit`.


- 2026-07-11T22:31:57.145+00:00 — Spawned on Wave 1 of feature-completeness epic #1008, issue #1009: UI primitives consolidation. Scope: `src/components/ui/**` (28 files), hooks consolidation (useLoadMoreList, useFilteredFetch, useMutation, useAdminAction), Wordmark dedup. Constraints: no scraper/content-pipeline imports; frozen zones (#946 active scraper work) remain untouched. Validation: typecheck, targeted ESLint (src/components/ui/ src/hooks/), smoke e2e baseline required before handoff. Baseline: PR #1007 merged (38ee3793), 571 files ≥98%, 110/110 routes, zero debt, CI 4309/4331 pass.
- 2026-07-12T01:54:08.000+00:00 — Completed Wave 1 PR #1021 cycle (issue #1009). Cycle 1 approved with advisory (spec not in canonical CI). Coordinator validation required cycle 2 because tabIndex assertions were tautological. Revised at c3e3fd7 wiring spec into canonical smoke gate and replacing helper checks with real Playwright keyboard navigation. Morpheus independently approved and merged to dev as 919da904. **Learnings:** (1) Executable E2E specs must be wired into canonical CI commands (`npm run e2e:smoke`), not left standalone. (2) Tautological helper assertions (tabIndex>=0 on already-disabled elements) must be replaced with real user-interaction verification (keyboard events).
- 2026-07-11T22:31:57.145+00:00 — Canonical E2E discovery is mandatory, and sequential Playwright reruns need isolated ports, DBs, and .next lifecycles to avoid cross-run contamination.
