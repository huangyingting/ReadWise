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
