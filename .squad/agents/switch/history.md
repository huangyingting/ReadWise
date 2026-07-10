# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app. Optional external providers must degrade gracefully when they are not configured.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.


- 2026-07-01T20:03:33.362+00:00 — Native coverage verifier landed, type errors were fixed, default gate now covers `src/`, `scripts/`, and `eslint-rules/`; 470 measured files passed >=98% plus typecheck and lint.
- 2026-07-01T23:11:49.008+00:00 — Final regrouping pass completed: merged 4 inbox decisions, no archive needed, and logged the semantic test regrouping outcomes.

- 2026-07-02T00:30:07.481+00:00 — Switch approved PR #874 after validation: targeted surfaces 181 pass, typecheck/lint pass, `npm test` 3601 pass / 0 fail / 22 skipped, coverage gate 472 files at >=98%, no IDE diagnostics.

- 2026-07-05T22:05:44.651+00:00 — Verified release recovery with coverage threshold 98, typecheck, lint, `npm test`, targeted admin AI ops Playwright, diff check, and workflow YAML parsing; current coverage denominator measured 496 files.
- 2026-07-05T23:02:20.863+00:00 — Verified the semantic UI audit split: 500 listed tests across 4 subsystem files, `@ui-audit` compatibility, 50 high-risk tests, admin-ai-ops pass, targeted lint, and typecheck.

- 2026-07-07T07:54:41.474+00:00 — Reviewed difficulty-scoring evaluation protocol; provider recomputes show B1 compression, so future validation should add gold fixtures, aggregate snapshots, and calibration metrics.


- 2026-07-07T09:08:07.205+00:00 — Validated CEFR calibration v2 with 42 targeted tests passing, typecheck passing, targeted ESLint passing, and `git diff --check` passing; caveated that no committed calibration harness/snapshot exists and the distribution skews advanced, so CEFR remains heuristic pending stronger gold corpus validation.


- 2026-07-07T10:06:10.688+00:00 — Rejected the initial OneStopEnglish v3 calibration for constructor-shadowed lexical normalization and missing caveats, then approved Morpheus' locked-out revision after 88 targeted tests, typecheck, targeted ESLint, diff-check, and provider aggregate validation passed.


- 2026-07-09T09:02:11.131+00:00 — Rejected the initial difficulty eval harness for a missing NC dataset gate, enforced reviewer lockout against Tank, then approved Morpheus' independent revision after 9/9 difficulty eval tests, ESLint, typecheck, diff-check, and aggregate-only provider smoke passed.


- 2026-07-09T23:20:17.074+00:00 — Approved hybrid calibration v4 after diff check, ESLint, typecheck, targeted Node tests (54/54), provider filter/count/aggregate smoke, and aggregate-only metric review.
