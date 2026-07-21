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

- 2026-07-11T22:31:57.145+00:00 — Final epic closure preserved the canonical E2E discovery and isolated port/DB/.next QA pattern; no new data/AI blockers remained.
- 2026-07-13T06:09:56.157+00:00 — Final #1035 mobile UI gates stayed green through main promotion: 5/5 smoke, 79/79 high-risk zero skips, 520/520 full UI audit, and 16/16 CTA matrix.

- 2026-07-14T13:39:03.638+00:00 — Issue #1057 PR #1058 Cycle-2 independent revision COMPLETE. Tank locked out per reviewer protocol; Mouse assigned as independent revision owner with sole authority. Delivered both blocking and advisory fixes: (1) Updated tests/optional-provider-boundaries.test.ts expectedExports array with 2 V1 exports (alphabetical order), 9/9 tests pass; (2) Replaced silent --target default in scripts/migrate-speech-timing.ts with explicit error for invalid values (omitted still defaults v2, backward compatible), added error test case, 6/6 tests pass. Validation: boundary 9/9, script 6/6, smoke (Tank V1 untouched) 36/36, typecheck/ESLint clean, 51/51 total pass. Commit b1d2f6d pushed; PR evidence comment posted; Switch re-review requested. Tank's V1 implementation frozen (zero regression). Ready for Switch independent re-review.

- 2026-07-14T15:52:34.647+00:00 — Issue #1060 data analysis: Offline MP3 + timing payload analysis on 217 rows / 937,273 aggregated timings. Examined V2 parser, unit conversion, AudioOffset derivation, token edge cases, standard MP3 encoder behavior (MPEG layer III ~33ms initial delay). Key findings: (1) MP3 offset hypothesis DISPROVEN (encoder behavior expected, no global systematic bias, all onsets within ±8ms of standard 33ms). (2) Data payload NOT primary drift cause (0 parsing errors, 0 negative durations, all 937K timings valid). (3) Secondary finding: span completeness issue — 151/217 rows retain full text-span arrays, 66/217 (30%) lose entire direct-span arrays due all-or-nothing serialization after single unaligned token. (4) Gap classification: 13,356 gaps >400ms are intentional paragraph silence, not data errors. Conclusion: browser-side measurement required (Trinity analysis). Trinity primary: 266ms timeupdate cadence. Mouse secondary: 66 articles lack spans (recovery available). All fixes can be runtime-only (no schema change).

- 2026-07-14T16:45:29.513+00:00 — Issue #1060 secondary fix implementation: Implemented span completeness recovery on PR #1061 (same branch as Trinity primary, squad/1060-reader-audio-highlight-sync). Root cause: 196/260 (75.4%) unaligned boundaries were Azure spoken-form expansions absent from plainText; all-or-nothing V2 serialization dropped entire span arrays for 66 articles. Solution: two-pass batch enrichment (source recovery via substring match, neighbor fallback for multi-word expansions), zero-duration artifact exclusion, lazy runtime compute (no schema migration). CLI: explicit --repair-spans dry-run/apply. Validation on local dev.db: complete spans 151/217 → 217/217 (100%), normalized timings 937,270/937,270 (99.999%), zero spoken words lost, monotonic preserved. Tests: 22 new repair + 10 integration (batch/CLI) = 32/32 pass. Zero-duration: 3 exclusions (expected encoder artifacts). typecheck/ESLint clean, backward compatible (V2 schema frozen). Reader files untouched (Mouse changes: parser/CLI only). Combined with Trinity primary fix (rAF clock): both on PR #1061 targeting dev. Ready for Switch coordinated review.


## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 1 (dev merge only), Cycle 2 independent rAF fix delivered to main

**Contribution:** Span recovery analysis and implementation (cycle 1 in PR #1061); rAF lifecycle analysis and recommendations (cycle 1); locked out of cycle 2 (original span-recovery author)

**Outcome:** Cycle 1 merged to dev (c624e56); Cycle 2 independent fix (Switch) approved and merged to main (c7becda); issue closed; span completeness 100% (151→217 articles); clock latency 98% improved

**Status:** Complete; no active blockers for span recovery or primary rAF fix

## 2026-07-21T03:45:00Z: Global review wave data/AI/Prisma/privacy shipped

- Shipped #1175–#1180 and #1192 through PRs #1198, #1199, #1200, #1201, and #1208.
- Carry-forward patterns: redact URL secrets in import/SSRF failures; keep SQLite/PostgreSQL paired migrations aligned for enums/fulltext indexes; delete orphaned speech blobs while degrading gracefully on persist failure; gate publish on real enrichment; use atomic budget denials; keep claim/reactivation lockstep via shared constants plus tests.
- Coordination lesson: module-boundary guards and shared constants are preferable to compatibility shims for superseded shapes.



## 2026-07-21T05:57:04+0000 — Cycle 2 global review data/AI/scraper/Prisma/privacy closure

- Shipped #1214/PR #1227 centralized logger metadata redaction (`a33f5d27`), #1215/PR #1228 sequential Prisma transaction cleanup (`d962120f`), #1217 ingest no-op gating, #1223/PR #1238 standalone read-model runtime import-cycle fix (`1f5d2500`), and #1224/PR #1239 canonical-conflict status single-sourcing (`f03978ff`).
- Reusable pattern: mirror Prisma enums through a pure client-safe leaf module with `import type` and bidirectional compile-time assertions so UI bundles stay Prisma-runtime-free while preserving enum lockstep.
- 2026-07-14T08:15:46.165+00:00 — Completed issue #1054 generation phase: ran Azure Batch TTS against prisma/dev.db (217 articles), generated 217 ArticleSpeech V2 rows and 217 MP3 files (gitignored), empirically verified timing accuracy (batch 318.91s vs MP3 319.21s, delta 0.30s, ratio 0.9991 — all within tolerance [0.75s, 0.90–1.15]), fixed analyzer V2 timing parser, corrected docs/.env.example comments, passed 63 tests/lint/typecheck/diff, committed 433879a (squad/1054-azure-batch-tts-word-sync), opened PR #1055 targeting dev. Critical unit risk resolved: batch emits milliseconds (not ticks), no 10,000× desync. Ready for Tank/Trinity parallel phase.
