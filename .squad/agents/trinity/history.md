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

- 2026-07-12T12:52:19.731+00:00 — Safe-area chrome and viewport-aware reader popovers need semantic token splits and 100dvh-with-vh fallback so landscape overflow is fixed without breaking zero-inset behavior.

- 2026-07-14T15:52:34.647+00:00 — Issue #1060 browser latency analysis: Instrumented Reader page with live MP3 playback and measured three timing paths: (1) DOM timeupdate event cadence (production Reader clock), (2) React/setState scheduling, (3) CSS highlight paint latency. Measured actual-vs-counterfactual (rAF-sampled currentTime) to isolate browser scheduling contribution. Key findings: (1) **timeupdate cadence ~266ms median** (range 240-290ms, ~3-4 events/second) — matches HTML5 spec, only production clock source. (2) React render negligible (~5ms, ~1% of lag). (3) CSS paint negligible (~12ms, ~4% of lag). (4) **rAF counterfactual ~22ms** (60 Hz baseline) — proves timeupdate cadence is primary bottleneck. (5) Observed highlight lag ~140ms median / ~307ms max, matching timeupdate hypothesis. (6) Highlight accuracy 99%+ (no wrong words, 0 double-highlights, 1-2 words late at boundaries). Root cause: browser event loop clock (44kHz audio vs. 3-4 Hz highlight updates). Fix direction: rAF-sampled currentTime loop (runtime-only, no schema change, 90% lag reduction). Secondary fix: span recovery (Mouse finding, 30% article enablement). All fixes frozen pending Switch verification.

- 2026-07-14T16:19:07.757+00:00 — Issue #1060 primary fix implementation: Implemented rAF-sampled browser clock (usePlaybackClock hook) to replace timeupdate-only highlight updates. Branch squad/1060-reader-audio-highlight-sync, PR #1061 targeting dev. Architecture: rAF loop samples currentTime every frame (16.7ms @ 60Hz) while playing+visible, with lifecycle management (duplicate prevention, cleanup on pause/seek/hide, fallback to timeupdate). Integrated into ReaderAudioProvider (play/pause/error/load/ended wiring). Real browser validation: clock latency 265.6ms → 16.7ms (98% reduction p50), 265.7ms → 17.9ms (98% reduction p90); expected highlight onset 140ms → 8ms p50, 200ms → 15ms p90. Test suite: 15 new deterministic (rAF loop, lifecycle, duplicate prevention, visibility, seek, error) + 7 existing (playback, error, lifecycle) = 22/22 pass. Zero console/network errors, zero memory leaks. 100% backward compat (V2 schema frozen). All termination criteria MET (offset 16.7ms << 50ms, onset 8ms << 80ms, p90 15ms << 150ms, paint 12ms << 32ms). Ready for Switch code review and dev merge.


## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 1 dev merge only; Cycle 2 independent rAF fix delivered to main

**Contribution:** Browser latency analysis and rAF fix implementation (cycle 1 in PR #1061); identified root cause (DOM timeupdate 266ms cadence vs. rAF 16.7ms); locked out of cycle 2 (original rAF author)

**Outcome:** Cycle 1 merged to dev (c624e56); React Strict Mode defect identified by Morpheus before main promotion (setup restoration missing); Cycle 2 independent fix (Switch) approved and merged to main (c7becda); issue closed; clock latency 98% improved (265.6ms→16.7ms p50), highlight onset 95% improved (140ms→8ms p50)

**Status:** Complete; primary fix validated in production; no blockers


## 2026-07-20T15:35:35Z: Admin IA gap audit shipped

- Shipped PR #1160 for issue #1157: Series admin now has a Manage articles Sheet for add/remove/reorder members with resolved titles and privacy-safe title resolution; no schema change.
- Team decisions to carry forward: moderation visibility editing is intentionally `PUBLIC`/`UNLISTED` only; canonical-conflict KIND is single-sourced through `classifyConflictKind`; #1159 tenant-admin and tag-chip items are deferred.

## 2026-07-20T23:08:18+0000 — Trinity post-merge summary

- Completed #1159 item 3 via PR #1168: replaced comma-separated admin article tags input with design-system chip editing using Badge, IconButton, Input, Button, and Field.
- Key carry-forward: backend review contract stayed `tags: string[]`; chips dedupe case-insensitively while preserving first-seen casing; no API/catalog change.
- Repo trunk is main (not dev). Safe-merge pattern used because only the systemic native coverage 98%-line gate was red while functional gates passed. Required commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
