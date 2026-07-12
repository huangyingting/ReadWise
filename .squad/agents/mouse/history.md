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
- 2026-07-02T00:30:07.481+00:00 — PR #874 moved admin scrape trigger orchestration into `src/lib/scraper/admin-trigger.ts`; the route remains auth/validation/HTTP adapter, with targeted tests/typecheck/lint passing.

- 2026-07-05T22:05:44.651+00:00 — Fixed scraper provider discovery test nesting and added scraper CLI/runtime coverage seams for native coverage; coverage gate passed with 496 measured files at >=98%.

- 2026-07-07T07:54:41.474+00:00 — Evaluated CEFR/Lexile-like scoring on the small local `prisma/e2e.db` sample: 3 article rows clustered at B1/1030 with low confidence and one stored/current mismatch; recommends short-text caveats and labeled calibration data.

- 2026-07-07T08:02:46.354+00:00 — Corrected CEFR/Lexile-like evaluation evidence now comes from `prisma/provider-dbs/workinprogress.db` (217 articles), superseding the earlier `prisma/e2e.db` sample for this analysis: CEFR B1 208, B2 7, A2 2; Lexile-like min 590/median 870/mean 861.66/max 1050; confidence high 165/medium 52/low 0.


- 2026-07-07T09:08:07.205+00:00 — Researched CEFR calibration datasets and recommended UniversalCEFR/elg_cefr_en as a temporary CC BY-NC 4.0 calibration source; raw text was not committed, and v2 CEFR outputs remain heuristic/calibrated baseline evidence pending stronger gold corpus validation.


- 2026-07-07T10:06:10.688+00:00 — Derived OneStopEnglish aggregate calibration stats, verified CC BY-SA 4.0 licensing, and kept raw text uncommitted; OSE `elementary`/`intermediate`/`advanced` labels are ordinal calibration anchors, not exact A1-C2 gold labels.


- 2026-07-09T09:02:11.131+00:00 — Specified the next calibration harness methodology: read-only evaluation, raw/license-restricted data outside the repo, aggregate `.calibration-state/` reports, provider DBs only from `prisma/provider-dbs/*`, dataset license gates, MIT-safe vocabulary audits, human labels without article text, Lexile-like metrics, and provider drift thresholds.


- 2026-07-09T23:20:17.074+00:00 — Derived v4 hybrid CEFR calibration targets using legal-approved NC UniversalCEFR A1-C2 aggregate labels plus OneStopEnglish ordinal article anchors, with provider guardrails and no raw calibration data committed.


- 2026-07-11T08:08:13.000+00:00 — Diagnosed and fixed PR #1005 CI failure: root cause was async/global-console test helper race in tests/check-schema-parity.test.ts and scripts/check-schema-parity.ts. Helper wrapping global console state around async callbacks was not awaiting restoration in finally block. Fixed with async/await + finally pattern and injectable output. Commit d1ba414. Stress-validated in exact CI environment: 571 files, 110/110 routes, zero debt. All checks passed. PR #1005 merged; issues #1000/#1001 closed.
- 2026-07-11T22:31:57.145+00:00 — Reviewer lockout chains must be respected, and local QA reruns should use isolated ports, DBs, and .next directories to avoid contamination from earlier runs.
