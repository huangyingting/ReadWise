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
