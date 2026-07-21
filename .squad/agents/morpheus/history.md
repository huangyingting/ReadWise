# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

## Compressed History (2026-07-01 → 2026-07-13)

- **2026-07-01:** Roster initialized. Coverage strategy decision merged. PR #874 modular refactor completed (disjoint ownership, non-blocking follow-ups).
- **2026-07-07:** Independently revised OneStopEnglish v3 calibration (after Tank lockout) with own-property guarded normalization maps and CC BY-SA 4.0 ordinal-anchor caveats; approved by Switch.
- **2026-07-09:** Independently revised difficulty eval harness (after Tank lockout) with explicit `--enable-nc` gate, `datasetSources` license metadata, docs/tests; approved by Switch.
- **2026-07-10:** ESLint 10 ecosystem-incompatible for PR #937 (left open with evidence); merged PR #938 (Node 24). APPROVE PR #963 (typed API security policy seams, 3805 tests). APPROVE PR #967 (speech/push/jobs optional-provider boundary refactor, all CI green).
- **2026-07-11:** PR #1005 cycle-1 rejected (coverage exit code 1, process status authoritative); cycle-2 approved (571 files ≥98%, 110/110 routes). PR #1006 dev→main promotion: approved and merged (5e1b892), post-merge CI green. Fact-checker correction: test count is 4331 (not 3880/3902). Epic #1008 audit complete: 23 candidates cross-validated (10 approved, 12 rejected/OOS, 1 duplicate); Wave 1 spawned (Trinity #1009, Tank #1010, Switch #1012). Lockout chains and evidence-trail pattern established.
- **2026-07-12:** PR #1021 onboarding E2E approved (tabIndex advisory, CI npm script advisory). PR #1020 cycle completed (native fixture coverage + 10 Chromium E2E scenarios; merged to dev 730bfc8). Marketing CTAs must be `<a href>` anchors (auth-boundary contract).
- **2026-07-13:** #1035 mobile UI audit main promotion verified (PR #1047 → a15412f; post-main CI + release passed; issue tree closed).

## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 2 complete, delivered to main

**Actions:**
- Cycle 1: Reviewed PR #1061 (Trinity primary + Mouse recovery); identified React Strict Mode rAF defect before main promotion; rejected promotion; locked Trinity; initiated cycle-2 independent fix
- Cycle 2: Reviewed and approved Switch's rAF lifecycle fix (f9418e5, PR #1063); merged to dev (447b3a4); verified post-dev CI; reviewed main promotion delta; merged PR #1062 to main (c7becda); verified post-main CI (4505/4505 pass); confirmed issue closed
- Post-delivery: Issue #1060 remains archived; no active blockers

**Verification:** All tests pass; all CI green; clock latency 98% improved; highlight onset 95% improved; span completeness 100%

**Status:** Complete

## 2026-07-14: Issue #1054/1057 — Speech pipeline complete

- Issue #1054 promotion: PR #1056 merged to main (61faa85); post-main CI 29329199289 SUCCESS; timing-unit milliseconds confirmed (all six phases complete).
- Issue #1057 compact V1 timing: design ratified, Switch cycle-1 rejection (barrel snapshot), Mouse cycle-2 revision approved, PR #1059 merged to main (04d9d7b); V2 writer/playback/routes/schema frozen throughout.
- Issue #1060 design ceremony: 8-layer root-cause matrix; DOM timeupdate (~250ms) as primary lag cause; rAF fix assigned Trinity; span repair assigned Mouse; Switch review gate.
- Issue #1060 cycle-1 retrospective: Trinity rAF approved, Mouse span-repair approved, coverage gap (timing-migration.ts 96.05%) blocked; Tank eligible for cycle-2; Mouse locked.

## 2026-07-21T03:45:00Z: Global review wave learning-domain/cross-cutting shipped

- Shipped #1182, #1183, #1184, and #1189 through PRs #1203 and #1206.
- Carry-forward patterns: placement count guard; progress timezone follows request → profile → UTC; weak-word ratio behavior is centralized but preserves distinct thresholds (`0.4` study-plan vs `0.5` recommendation re-exposure); `lemmaFor` and completion threshold aliases remain for back-compat.
- Coordination lesson: behavior-preserving refactors should name different domain thresholds separately rather than collapsing them for apparent simplicity.



## 2026-07-21T05:57:04+0000 — Cycle 2 global review learning-domain/cross-cutting closure

- Shipped #1212 timezone day-boundary consistency, #1213 `progress_complete` analytics dedupe, #1221/PR #1236 `RESUME_MAX_PERCENT = COMPLETION_THRESHOLD - 1` (`310b84a6`), and #1222/PR #1237 deterministic index-backed capped mastery/re-exposure scans (`8905bc93`).
- Reusable pattern: derive resume windows from the canonical completion threshold and pair capped scans with deterministic indexed `orderBy` clauses to avoid unstable pagination/selection.

## 2026-07-21T14:17:00Z — Assignment lifecycle refactor design gate

- Conducted design-gate analysis for classroom assignment feature completeness (RW-061, #1164 follow-on). Verified three gaps: (1) reader has no assignment awareness; (2) reading to 100% does NOT advance assignment (only quiz/manual toggle); (3) IN_PROGRESS is a dead state.
- Locked target process: student opens assigned article → reader shows `AssignmentBanner` → reading auto-advances lifecycle. Teacher sees 3-state board (Not started / In progress / Completed).
- Locked state-transition rules (monotonic): absence of row = ASSIGNED; `ASSIGNMENT_START_PERCENT` → IN_PROGRESS (only when no existing row); `COMPLETION_THRESHOLD` → COMPLETED (sticky `completedAt`, never clobber `quizScore`); quiz-driven completion unchanged; manual Undo for MANUAL completions only.
- **No schema change** decision: `AssignmentStatus` enum + `AssignmentCompletion.status/quizScore/completedAt` model the full lifecycle already.
- Broke work into sequential 3-PR plan: Tank (PR1/backend) → Trinity (PR2/frontend) → Switch (PR3/integration tests). Filed decision to inbox; all three PRs merged to `main`.
- Hotfix context: coordinator handled api-catalog drift (`b7ae615c`) to unblock the PR stack before agent dispatch.
- Merged PRs: #1241 (`b7ae615c`), #1240 (`7d73171c`), #1242 (`01e46a2b`), #1243 (`c5a89b47`).
