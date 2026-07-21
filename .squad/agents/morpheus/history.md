# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.


- 2026-07-01T20:03:33.362+00:00 — Coverage strategy decision inbox entry was merged into `decisions.md`; ownership strategy preserved, and final coverage/typecheck/lint validation passed.
- 2026-07-01T23:11:49.008+00:00 — Decision inbox was merged into decisions.md with no archive required (3901 bytes), preserving the coverage/test-suite governance trail.

- 2026-07-02T00:30:07.481+00:00 — Modular refactor PR #874 completed: Morpheus bounded the first PR with disjoint ownership and later approved stop with only non-blocking follow-ups.


- 2026-07-07T10:06:10.688+00:00 — Independently revised OneStopEnglish v3 after Tank reviewer lockout, adding own-property guarded contraction/irregular map lookups and explicit CC BY-SA 4.0 ordinal-anchor caveats; final version was approved by Switch.


- 2026-07-09T09:02:11.131+00:00 — Independently revised the difficulty eval harness after Tank reviewer lockout, adding explicit `--enable-nc` handling, `datasetSources` license/non-commercial metadata, and docs/tests updates; final version was approved by Switch.

- 2026-07-10T03:07:51.970+00:00 — Confirmed stable ESLint 10 remains ecosystem-incompatible for PR #937 and left it open with evidence; merged approved PR #938 via merge commit `c65355904c3c8c9d8782c5a809b156899a6b9cb6` and deleted its remote branch.

### 2026-07-10 — PR #963 review (Wave 2b: typed API security policy seams)

**Verdict:** APPROVE. Posted evidence-rich comment (formal approve blocked by own-PR constraint).

**Key findings:**
- All 3 exemplar routes (`search`, `client-errors`, `today`) preserve exact execution order, identifier derivation, scope, limit/window source, response status/body/headers, and failure behavior.
- `client-errors` improvement: old catch-all now narrowed to `ApiError(429)` only — stricter.
- `RateLimitPolicy` correctly centralizes mechanics while keeping route-specific values explicit.
- `FeatureGate` is thin but justified given 6 remaining Today routes (#962).
- Barrel narrowing safe — no external consumers imported store symbols through the barrel.
- No `any`, unsafe casts, cycles, new deps, secret logging, or API contract drift.
- Tests characterize behavior (status/body/failure), not just types.
- Follow-ups #961/#962 correctly scoped with accurate file lists.
- Required CI 4/4 green. PostgreSQL failure (non-required) not PR-attributable.
- Local: 3805/3805 tests pass.

**Review URL:** https://github.com/huangyingting/ReadWise/pull/963#issuecomment-4934054841

## 2026-07-10 — PR #967 Review (Issue #947)

**Verdict: APPROVE**

Reviewed speech/push/jobs optional-provider boundary refactor. Verified:
- Import graphs: no cycles, no barrel back-imports, no private internal leakage
- Speech/Push degradation semantics and privacy preserved
- Jobs cast removal with typed guards (payloadInputJsonObject, parseErrorHistoryEntry)
- PG fixture fix evidence-based: lexileApprox/difficultyVersion added to match processor.ts enrichment completeness filter
- Boundary tests robust (structural properties, not brittle inventory)
- Route API contract unchanged
- All CI checks green including PG integration

Review comment: https://github.com/huangyingting/ReadWise/pull/967


- 2026-07-11T08:08:13.000+00:00 — Facilitated PR #1005 retrospective and closure. Evidence-backed lessons: IPC helpers wrapping global state around async callbacks must await and restore in finally blocks (specific pattern); process exit status authoritative over printed output; high-risk CI changes benefit from stress-run validation in exact CI environment. Caution: describe IPC causality specifically, not universally. Tank unblocked, all issues #1000/#1001 closed, zero-debt milestone achieved.

- 2026-07-11T08:08:13.000+00:00 — Independently reviewed and approved PR #1006 (dev → main promotion): ancestry clean, no force-push history, content clean (merge-only operation), all checks green (3880/3902 pass, 571 files ≥98%, 110/110 routes, zero debt baseline maintained). Posted evidence comment; no formal review blocker due to shared agent identity. Merge commit 5e1b892 verified on main. Post-merge CI run 29159258667 all-green.

- 2026-07-11T22:12:32.607+00:00 — FACT-CHECKER CORRECTION to the 2026-07-11T08:08:13 PR #1006 review entry: the stated unit-test count 3880/3902 is inaccurate. Primary CI evidence from runs 29157691749, 29159079071, and 29159258667 reports 4331 tests: 4309 passed, 22 skipped, 0 failed. All other claims in that entry remain verified: main merge 5e1b892ae21c089feac9724dc78c8fbd010859ff, 571 files at >=98%, 110/110 routes, zero debt, and successful post-merge CI.


- 2026-07-11T22:31:57.145+00:00 — Feature-completeness epic #1008 audit lanes complete: 23 raw candidates cross-validated (10 approved, 12 rejected/out-of-scope, 1 duplicate/superseded). Five independent lanes (architecture, frontend, backend, data/AI, quality/ops) performed read-only design review. User decisions archived: classroom membership teacher-managed; defer topology/corpus-dependent automation. Autonomous defaults established: evidence-backed decision-making for non-destructive choices. Wave plan published in #1008 comment 4949323602. Wave 1 spawns: Trinity #1009, Tank #1010, Switch #1012 (zero blocking dependencies). Deferred-AC tracking requirement: child issues filed for vocabulary.ts AC#1 (blocked by #946), article-library 7 deferred items (blocked by #946 scraper/content-pipeline seam). Critical: frozen zones remain unchanged until #946 merges. Post-merge CI baseline: 571 files ≥98%, 110/110 routes, zero debt, 4309/4331 tests pass.
- 2026-07-11T22:31:57.145+00:00 — Epic #1008 showed formal-review comments are the review artifact of record under shared identity, and rejection/lockout chains must be kept intact when authors revise.

- 2026-07-11T22:31:57.145+00:00 — Under shared identity, the accepted promotion verdict is the evidence-backed review trail for PR #1032, not a formal approval object.
- 2026-07-12T12:52:19.731+00:00 — Marketing CTAs that cross into sign-in should be semantic `<a href>` anchors, not button surrogates; auth-boundary navigation is a product contract, not just styling.

- 2026-07-13T06:09:56.157+00:00 — Verified #1035 main promotion closure: PR #1047 merged to `a15412fae26d2b2790a6d7161603cd66c60ee951`, post-main CI and release both passed, and the issue tree closed cleanly.

- 2026-07-14T08:15:46.165+00:00 — Finalized issue #1054 promotion to main: approved and merged PR #1056 to origin/main at 61faa85. Pre-merge validation: merge base clean (main 8434440 ← dev e397f58), delta exactly 6 files (+56/−11 lines), no unrelated commits, code integrity verified (batch stores milliseconds, analyzer fix correct, config aligned). Pre-merge CI: PR #1056 run 29328863505 and post-dev 29328606705 all required checks green. Post-main CI: 29329199289 SUCCESS. Release workflow correctly skipped (no version metadata change). Issue #1054 CLOSED. All six phases complete: Morpheus design → Mouse generation (0.9991) → Tank backend (0.999) → Trinity browser (1.0009) → Switch review/merge → Morpheus promotion. Timing-unit milliseconds confirmed, all acceptance criteria met, post-main CI passed. No article content/secrets recorded; aggregates only.

- 2026-07-14T12:34:36.967+00:00 — Completed issue #1057 design review ceremony: ratified compact V1 word-timing storage contract `{version:1, words[], startMs[], endMs[]}` with normalization to V2 parsing (provider="unknown", no text spans). Implementation: parser gate `version===1` before metadata gates, add V1 serializers, migration tooling opt-in `--target v1` (default stays V2). Production `saveSpeechResult` frozen on V2. Boundaries: storage/parse only, Reader playback frozen, highlights frozen, no schema/dev.db migration. Ownership: Tank (parser/migration/tests), Switch (V2-byte regression review), Trinity standby. Issue #1057 filed and assigned.

- 2026-07-14T13:10:40.805+00:00 — Issue #1057 Retrospective: Switch rejected PR #1058 (Tank V1 implementation) with REQUEST_CHANGES due to barrel-export snapshot test failure (2 exports missing from expectedExports array). Morpheus verified Tank implementation is architecturally correct: 46/46 tests pass, V1 shape valid, parser gate placed correctly before V2 metadata, V2 writer/playback frozen, normalization verified. Blocking issue is test-discipline gap, not code logic problem. Approved Cycle 2 revision scope: Must-include barrel export array update (2 entries, 2-line fix, 9/9 test pass verification); Should-include explicit --target error in parseArgs() (aligns with repository explicit-error rule, tight coupling). Tank locked out per reviewer protocol; Mouse assigned as independent cycle-2 revision owner with sole authority. Lockout chain enforced. Learning: pre-existing barrel-snapshot tests must be updated in same commit as new public exports; reviewer lockout prevents author bias. Ready for Mouse revision.

- 2026-07-14T13:58:58.884+00:00 — Issue #1057 finalization: Approved and merged PR #1059 (dev→main promotion) at merge commit 04d9d7b. Issue #1057 auto-closed. Verified narrow promotion delta (8 files, +633/−15, correct ancestry). Post-main CI 29338449221 success. Release workflow correctly skipped (version metadata unchanged). Final contract verification: V1 shape exact {version:1,words[],startMs[],endMs[]}, parser gate before V2 metadata, legacy arrays read-only, V2 writer/playback/routes/schema frozen (diff zero), migration defaults v2 with opt-in --target v1 and explicit invalid-target error. Governance chain complete: Switch cycle-1 rejection → Tank locked → Mouse independent revision → Switch cycle-2 approval → Morpheus main merge. Lockout protocol enforced throughout. All CI green. Issue complete; compact V1 timing storage now in production.

- 2026-07-14T14:57:52.990+00:00 — Issue #1060 design review ceremony: Conducted root-cause spike analysis for speech/highlight word-level desynchronization. 8-layer root-cause matrix: (A) Azure batch semantics, (B) MP3 encoder offset, (C) unit conversion, (D) UTF-16 spans, (E) token edge cases, (F) silence-gap policy, (G) browser timeupdate cadence/React scheduling, (H) CSS paint latency. Empirical evidence (937,273 words, 100% coverage, internally clean): data quality confirmed. Likely root cause: Reader highlight driven only by DOM timeupdate (~250ms cadence), appearing late. Fixes frozen pending evidence. Assigned Mouse (data/audio offline, layers A-E+G), Trinity (browser latency, layers F-H), Switch (reviewer gate). Evidence-gated fix sequencing: (1) browser scheduling, (2) MP3 offset, (3) text semantics, (4) gap policy tuning. Termination criteria: 6 measurable gates defined. No code changes in ceremony; backward compat preserved (V2/V1 frozen).

- 2026-07-14T16:58:42.591+00:00 — Issue #1060 PR #1061 cycle-1 retrospective: Analyzed Switch REQUEST_CHANGES (coverage-only, not design). Trinity rAF artifact approved (98% latency reduction, 22/22 tests). Mouse span-repair approved (100% completeness, 32/32 tests). Missing: timing-migration.ts 3 edge branches (parse-null, all-zero-duration, Prisma error). All reachable, must be tested per 98% team standard. Lockout decision: Mouse locked (span-repair test author, cannot self-revise). Tank eligible cycle-2 (different artifact from #1057, independent scope, additive timing-migration edge tests, non-conflicting). Confirmed blocking factor: coverage gap, not design. Approved blocking-only semantics (coverage enforcement). Tank cycle-2 independent authority confirmed.


## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 2 complete, delivered to main

**Actions:**
- Cycle 1: Reviewed PR #1061 (Trinity primary + Mouse recovery); identified React Strict Mode rAF defect before main promotion; rejected promotion; locked Trinity; initiated cycle-2 independent fix
- Cycle 2: Reviewed and approved Switch's rAF lifecycle fix (f9418e5, PR #1063); merged to dev (447b3a4); verified post-dev CI; reviewed main promotion delta; merged PR #1062 to main (c7becda); verified post-main CI (4505/4505 pass); confirmed issue closed
- Post-delivery: Issue #1060 remains archived; no active blockers

**Verification:** All tests pass; all CI green; clock latency 98% improved; highlight onset 95% improved; span completeness 100%

**Status:** Complete

## 2026-07-21T03:45:00Z: Global review wave learning-domain/cross-cutting shipped

- Shipped #1182, #1183, #1184, and #1189 through PRs #1203 and #1206.
- Carry-forward patterns: placement count guard; progress timezone follows request → profile → UTC; weak-word ratio behavior is centralized but preserves distinct thresholds (`0.4` study-plan vs `0.5` recommendation re-exposure); `lemmaFor` and completion threshold aliases remain for back-compat.
- Coordination lesson: behavior-preserving refactors should name different domain thresholds separately rather than collapsing them for apparent simplicity.



## 2026-07-21T05:57:04+0000 — Cycle 2 global review learning-domain/cross-cutting closure

- Shipped #1212 timezone day-boundary consistency, #1213 `progress_complete` analytics dedupe, #1221/PR #1236 `RESUME_MAX_PERCENT = COMPLETION_THRESHOLD - 1` (`310b84a6`), and #1222/PR #1237 deterministic index-backed capped mastery/re-exposure scans (`8905bc93`).
- Reusable pattern: derive resume windows from the canonical completion threshold and pair capped scans with deterministic indexed `orderBy` clauses to avoid unstable pagination/selection.
