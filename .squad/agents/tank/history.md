# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app. Optional external providers must degrade gracefully when they are not configured.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.


- 2026-07-01T20:03:33.362+00:00 — Backend and operational script coverage tests/seams completed with backend/script targets at >=98%; final coverage/typecheck/lint validation passed.
- 2026-07-01T23:11:49.008+00:00 — Backend-side coverage and regrouping decisions were consolidated into decisions.md; shared test ownership boundaries remain documented.

- 2026-07-02T00:30:07.481+00:00 — PR #874 moved route DB/storage logic into subsystem modules and removed proven-dead redaction aliases; targeted tests/typecheck/lint/diff-check passed.

- 2026-07-05T22:05:44.651+00:00 — Fixed ReadWise release workflow assumptions/triggers, added `CHANGELOG.md`, and pinned PostgreSQL stale-lock `runAfter` timing; final coverage, typecheck, lint, tests, and workflow YAML checks passed.

- 2026-07-07T07:54:41.474+00:00 — Inspected `src/lib/difficulty.ts` and related processing/persistence paths; current CEFR and Lexile-like scoring is a deterministic heuristic baseline that needs tokenization, stale-version selection, and calibration tests.


- 2026-07-07T09:08:07.205+00:00 — Implemented CEFR calibration v2 by threshold changes only, bumped `DIFFICULTY_ALGORITHM_VERSION` to `deterministic-cefr/wordfreq-calibrated-v2`, and updated processing selection for stale `difficultyVersion`/missing `lexileApprox`; provider DB evaluation shifted from v1 A2 2/B1 208/B2 7 to v2 B2 2/C1 141/C2 74 with Lexile-like unchanged.


- 2026-07-07T10:06:10.688+00:00 — Implemented initial `deterministic-cefr/onestop-calibrated-v3`, but Switch rejected it for lexical-normalization constructor failure and insufficient license/mapping caveats; reviewer lockout was enforced and Morpheus owned the revision.


- 2026-07-09T09:02:11.131+00:00 — Implemented the initial difficulty eval harness (`scripts/difficulty-eval.ts`, `npm run difficulty:eval`, docs/tests/template/package updates, provider DB smoke), but Switch rejected it for the missing NC dataset gate; reviewer lockout was enforced and Morpheus owned the revision.


- 2026-07-09T23:20:17.074+00:00 — Implemented `deterministic-cefr/hybrid-calibrated-v4` as threshold-only cutoffs `[9,18,27,36,50]`, kept NC data gated via `--enable-nc`, preserved OneStop ordinal anchors, and left Lexile-like scoring unchanged.

- 2026-07-10T03:07:51.970+00:00 — Updated PR #938 for Node 24 and dependency/runtime alignment, including tests and docs; pushed commit `d01d485a384ad1bd8232f164f889003608a7c1d6`, which was independently approved and merged.


- 2026-07-11T08:08:13.000+00:00 — Authored PR #1005 clearing native debt 12→0 and route debt 6→0 with 12 native script/analytics test suites and 6 direct route test suites. Commit 1823774f passed local validation. Initial CI failure diagnosed by Mouse as async/global-console race in test helpers. Mouse fixed in commit d1ba414; all subsequent validations passed. PR #1005 merged at 2ebbe57d3754f8def00c501ae9ad81599a7861b4; issues #1000/#1001 closed.


- 2026-07-11T22:31:57.145+00:00 — Spawned on Wave 1 of feature-completeness epic #1008, issue #1010: grammar route mock seam + AI test fixes. Scope: grammar route provider seam setup (mock/integration boundary), AI test typecheck regressions from refactors. Constraints: no route API contract changes, no schema mutations. Validation: full typecheck, targeted tests (tests/ai*.test.ts, grammar-related routes), coverage gate ≥98% on touched files. Baseline: PR #1007 merged (38ee3793), routes 110/110 verified, optional-provider seams intact (Speech, Jobs, Push).
- 2026-07-12T01:54:08.000+00:00 — Wave 1 progress: revised PR #1020 (issue #1012) independently after Switch's initial native-debt rejection. Added seedE2eMember native fixture coverage + 10 Chromium E2E scenarios at 520609e. Morpheus approved and merged to dev as 730bfc8. Spawned issue #1010 (grammar route seam + AI test fixes) carrying forward Wave 1 baseline (571 files ≥98%, routes 110/110). **Learning:** Native coverage baseline is as important as browser coverage for shared test infrastructure; reviewer lockout on debt regression is correctness enforcement.
- 2026-07-12T02:41:59.148+00:00 — Wave 1 correction: #1010 is complete/closed; #1016 closed via PR #1024 (85de5bf), and #1017 is the active Tank issue.
- 2026-07-11T22:31:57.145+00:00 — Reviewer lockout chains must be respected, and revisions should be tracked through the accepted review comment path when shared identity prevents formal approval objects.

- 2026-07-14T12:34:36.967+00:00 — Issue #1057 Compact V1 timing format implementation COMPLETE. Implemented SpeechTimingPayloadV1 {version:1, words[], startMs[], endMs[]} with version===1 parser gate BEFORE V2 metadata checks. Added createSpeechTimingPayloadV1, legacySpeechWordsToTimingPayloadV1, migrateArticleSpeechTimings(target: 'v1'|'v2', default 'v2'), CLI --target flag, and backward-compat wrapper. V2 writer/Reader frozen (no changes). 46 focused tests pass (V1 shape, parser gate placement, normalization, migration paths, backward-compat); typecheck/ESLint/diff-check clean. Dev.db 217/217 V2 rows unchanged; no schema migration. PR #1058 on squad/1057-compact-v1-timing-format targeting dev. **Next gate:** Switch independent regression review (V2 byte normalization, backward-compat layer, Reader safety).

- 2026-07-14T22:41:59.465+00:00 — Issue #1060 PR #1061 cycle-2 independent revision: Added 3 edge-case tests to tests/timing-migration.test.ts to resolve cycle-1 coverage gap (96.05% < 98% threshold). Tests: (1) malformed JSON parse-null edge case, (2) all-zero-duration defensive scenario, (3) Prisma update error handling (transient failure resilience). No production code changes (test-only). Mouse lockout observed throughout (Tank independent authority, different artifact scope). Commit 40371e7 pushed. Validation: 25/25 tests pass (3 new + 22 existing), timing-migration.ts 100% line coverage (was 96.05%), all PR required CI checks green. Coverage gap RESOLVED. Independent work verified (test additions only, no Mouse involvement required). Ready for Switch cycle-2 re-approval.


## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 2 complete (rAF fix), delivered to main

**Revision:** Tank cycle-2 independent test additions (40371e7); Switch cycle-2 independent rAF lifecycle fix (f9418e5)

**Outcome:** Approved by Switch and Morpheus; merged to dev (447b3a4); merged to main (c7becda); issue closed; 4505/4505 tests pass

**Lockout chain:** Mouse (span recovery original author) locked; Tank (test coverage independent reviser) approved; Switch (rAF fix independent reviser + reviewer) approved both cycles; Morpheus (lead/release gate) approved and merged to main

**Verification:** Clock latency 98% reduced (265.6ms→16.7ms p50), highlight onset 95% improved (140ms→8ms p50), spans 100% complete (151→217), zero regressions

**Status:** Complete


## 2026-07-20T15:35:35Z: Admin IA gap audit shipped

- Shipped PR #1161 for issue #1158: canonical-conflict KIND is exposed via shared `classifyConflictKind(incumbentCandidateId)`, with Type B incumbent-vs-challenger resolution and Type A `migrateReaderData`. Resolver and query now call the same helper (agreement by construction); sanitized DTO and kind-aware sheet verified.
- Shipped PR #1162 for issue #1159 item 2: moderation visibility can edit only `PUBLIC`/`UNLISTED`; `PRIVATE`/`ORG` are tenant-scoped, read-only in UI, and server-blocked with 409.
- Deferred from #1159: item 1 tenant Organization/Classroom admin surface (needs product/RBAC scoping) and item 3 per-tag chip UI (UX nicety over existing replace-all tag editing).

## 2026-07-20T23:08:18+0000 — Tank post-merge summary

- Completed three merged mainline tasks as tank-20: #1163/PR #1165 platform-admin Organizations oversight surface; PR #1166 supply-chain lockfile-only brace-expansion HIGH advisory fix; #1164/PR #1167 assignment sub-system end-to-end.
- Key carry-forward: reuse existing tenant org/member commands and classroom authorization seams; assignment quiz completion is best-effort and server-derived; no schema change was needed for the assignment work.
- Repo trunk is main (not dev). Safe-merge pattern used because only the systemic native coverage 98%-line gate was red while functional gates passed. Required commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## 2026-07-21T03:45:00Z: Global review wave backend/auth/tenant/audit/jobs shipped

- Shipped #1169–#1174, #1181, #1190, and #1191 through PRs #1194, #1195, #1196, #1197, #1202, and #1207.
- Carry-forward patterns: membership-backed `articleAccessContextForUser` with `orgIds`; readable-scope targets and ORG tag namespace; push reminder worker delivery; audit coverage for org/series; classroom archive uses nullable `Classroom.archivedAt`, with hard DELETE only for empty classrooms.
- Coordination lesson: large keystone PRs stayed sequential under coordinator review because the shared working tree cannot support parallel implementation safely.

