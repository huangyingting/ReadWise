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
