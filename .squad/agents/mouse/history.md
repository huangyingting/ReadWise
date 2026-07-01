# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app. Optional external providers must degrade gracefully when they are not configured.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-07-01T10:12:10.549+00:00 — Squad roster initialized for ReadWise: Morpheus (Lead), Trinity (Frontend Dev), Tank (Backend Dev), Mouse (Data/AI Pipeline), Switch (Tester), Scribe (Session Logger), Ralph (Work Monitor), Rai (RAI Reviewer). Static roster/routing/charter config was updated; mutable state remains owned by runtime state tools.

## 2026-07-01T20:03Z coverage loop 2
- Added focused node:test coverage in `tests/pipeline-coverage-loop2-*.test.ts` plus `tests/fixtures/dict-loop2/en-50k.json` for pipeline/data/scraper/AI targets.
- Verified `NODE_ENV=test node --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/pipeline-coverage-loop2-*.test.ts` (76 pass), full targeted coverage gate for 30 requested files at >=98%, and `npm run typecheck`.


- 2026-07-01T20:03:33.362+00:00 — Pipeline, scraper, AI, and script coverage tests/seams completed with pipeline/script targets at >=98%; final coverage/typecheck/lint validation passed.