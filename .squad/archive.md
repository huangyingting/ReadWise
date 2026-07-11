# Squad Decisions Archive

## Archived 2026-07-11T10:00:02.640975

### 2026-07-01 — Coverage strategy ownership and verification

**Source:** Morpheus inbox (`decisions/inbox/morpheus-coverage-strategy.md`)

Treat the 98% coverage request as a coordinated, staged coverage program rather than a blind loop over files. Establish an explicit denominator and baseline first, split ownership by domain, and prevent shared-file churn.

**Evidence from repo inspection (2026-07-01):**
- `package.json` has `npm test` on Node's built-in runner with `--experimental-strip-types` and module mocks; no coverage script or third-party coverage runner is configured.
- Source inventory is large: about 876 `src/**/*.{ts,tsx}` files (583 TS, 293 TSX), plus 22 scripts; there are 281 Node tests and 10 Playwright specs.
- Next/API/backend surface is broad: 104 `src/app/api/**/route.ts`; rough static scan found 81 route module imports in tests and about 23 route files not directly imported.
- UI surface is the biggest tooling risk: about 293 TSX files, about 166 rough `"use client"` modules, 37 pages, and 3 layouts.
- Probe: native Node coverage with `--test-coverage-include='src/lib/result.ts' --test-coverage-include='src/lib/backoff.ts' --test tests/result.test.ts` reported only imported `result.ts`; unimported code did not enter the denominator.
- Probe: importing `src/components/ui/Button.tsx` under the current Node strip-types hook failed with `ERR_UNKNOWN_FILE_EXTENSION`, confirming TSX/runtime UI files are not directly covered by the current Node test command.

**Decision / strategy:**
1. Define the coverage denominator before implementation: include handwritten `src/**/*.{ts,tsx}` and selected `scripts/**/*.ts`; exclude generated artifacts, `.next`, Prisma generated client, test/e2e files, declarations, and config-only files only by written policy.
2. Add a coverage inventory gate separate from Node's native percentage gate. Native coverage can validate imported files, but a repo manifest must fail files that are never imported/covered; otherwise 98% can be falsely satisfied.
3. Prioritize high-risk pure logic and server seams first. Do not inflate coverage with import-only tests unless the file is intentionally a barrel/config contract.
4. For TSX/UI files, prefer extracting behavior into small TS helpers/hooks that Node tests can exercise, while using Playwright for interaction/page smoke. If strict per-file TSX coverage remains mandatory, adopt an explicit TSX-capable coverage runner/harness as a separate tooling decision; native node:test alone is insufficient.
5. Avoid shared-file conflicts by freezing shared helpers/tooling ownership: Switch owns coverage harness/manifest and final validation; implementers add domain tests without editing the harness unless coordinated.

**Ownership:**
- Switch: coverage denominator, baseline report, inventory/fail-fast mechanics, final validation loop, and review of import-only tests.
- Tank: backend/API route/service coverage, auth/RBAC, runtime config, Prisma SQLite/PostgreSQL parity, provider fallback tests.
- Mouse: scraper/import/content pipeline, AI enrichment, vocabulary/study-data transforms, privacy-safe fixtures and degraded-provider tests.
- Trinity: UI/client behavior, page/component seams, accessibility/focus/loading/empty/error states, TSX tooling recommendation or pure-helper extraction plan.

**Validation recommendation:**
Start with `npm test` plus a project-local coverage run; for DB-sensitive work add `npm run test:db` with PostgreSQL; for UI behavior keep Playwright smoke separate. Run `npm run typecheck` when shared types/routes/contracts move. Do not rely on Playwright for source line coverage unless source-map collection is intentionally designed.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 2026-07-01T23-01-59 — Merge only clean Dependabot PRs with passing checks

**Source:** Morpheus inbox (`decisions/inbox/Morpheus-merge-only-clean-dependabot-prs-with-passing-check.md`)

For the merge pass on main, merge only open Dependabot PRs whose merge state is CLEAN, are not draft, and whose required-style CI rollup has completed successfully (allowing the configured skipped E2E smoke). Skip UNSTABLE PRs with failing checks and use squash merge for eligible Dependabot PRs rather than bypassing protections.

### 2026-07-01T23-13-39 — Test suite cleanup batching and naming plan

**Source:** Morpheus inbox (`decisions/inbox/Morpheus-test-suite-cleanup-batching-and-naming-plan.md`)

Clean the 332 Node test files by semantic ownership batches instead of alphabetical slices or blanket coverage-prefix sweeps. Preserve behavior while reducing fragmentation, duplicate coverage-only wrappers, and unclear file names.

**Semantic buckets:** reader/UI/articles/library; scraper/content ingestion/import; AI/language/tutor; learning/today/study; org/admin/analytics/classroom; auth/security/privacy/policy; speech/pronunciation/TTS; jobs/push/observability/runtime; shared runtime/storage/tooling; db/postgres integration.

**Batching rule:** one implementation agent owns a disjoint file list per batch. No two agents edit the same existing file concurrently. Shared helpers under `tests/helpers.ts`, `tests/support/**`, fixtures, coverage harness files, and package scripts are frozen to Switch unless explicitly coordinated.

**Rename/merge convention:** prefer `tests/<domain>-<capability>.test.ts` using the existing flat `tests/` layout, with `tests/db/postgres-<capability>.test.ts` preserved for DB integration. Names should describe product semantics, not implementation history or coverage campaigns. Retire prefixes such as `pipeline-coverage-`, `backend-coverage-`, `remainder-coverage-`, and `script-coverage-` by merging their assertions into the semantic owner file when they test the same module. Route files keep `-routes` or `-route` suffix only when the route behavior is the primary contract; otherwise merge into the feature file. Keep provider-specific names only when a provider contract is distinct.

**Deletion candidates:** coverage-prefixed tests are likely duplicate/dead-code candidates after comparison: `backend-coverage-*`, `pipeline-coverage-*`, `remainder-coverage-*`, `script-coverage-*`. Delete only after moving unique assertions and proving targeted tests still pass. No `.skip`/`.only`/`TODO` markers were visible in tests during review. Support files appear used and should not be deleted without import-count proof.

**Validation:** after each batch run the narrow node test glob for touched files with the project node test command; run `npm test` after each agent completes a domain batch; run `npm run test:db` for `tests/db` changes; run `npm run typecheck` after broad renames/import edits or shared helper moves; run `npm test` plus `npm run coverage:node` as final suite validation, and `npm run test:e2e:smoke` only if Playwright/e2e/UI smoke files are touched.

**Ownership:** Switch owns mechanics, naming consistency, coverage-prefixed migration, shared helpers, coverage-gate/tooling/runtime-cleanup, and final validation. Mouse owns scraper/content-ingestion/import tests. Tank owns backend/API/db/runtime/auth/admin/jobs/speech/storage/provider tests. Trinity owns frontend/UI/reader interaction tests only.

### 2026-07-01 — Semantic regrouping of coverage-prefixed tests

**Source:** Switch inbox (`decisions/inbox/switch-test-regrouping.md`)

Classified the 332 Node test files into Morpheus' subsystem buckets, then removed all stale coverage-prefixed test filenames except the intentional `tests/coverage-gate.test.ts` coverage-tooling test. Renamed 50 coverage/remainder/script/frontend/backend coverage files to semantic `tests/<domain>-<capability>.test.ts` names while preserving assertions and behavior. Kept PostgreSQL integration names under `tests/db/postgres-*.test.ts`.

**Inventory buckets:** DB integration (10); AI/language/tutor (35); scraper/ingestion/imports (56); learning/today/study (71); reader/UI/article library (37); org/admin/classroom/analytics (25); auth/security/privacy/policy (29); speech/pronunciation/TTS (11); jobs/push/observability/runtime (37); shared runtime/storage/tooling (19); other durable fixtures/features (2).

**Duplicate/dead-code evidence:** Exact-file duplicate scan over `tests/**/*.test.ts` found `exact_duplicate_files=0`. Duplicate test titles were either parameterized cases or equivalent route/security patterns in different modules, so no assertions were deleted. The only stale internal coverage label found after renames was a scraper state directory string; it was updated from `.scraper-state/script-coverage-scrapers` to `.scraper-state/scripts-scrapers`.

**Validation:** Touched test set passed with the existing Node test command. Full `npm test` passed. `npm run coverage:node` passed. `rg` confirmed no remaining `pipeline-coverage`, `backend-coverage`, `remainder-coverage`, `script-coverage`, or `frontend-coverage` references in tests/package/scripts.

### 2026-07-01T23-27-25 — UI catchall tests split by helper and hook functionality

**Source:** Switch inbox (`decisions/inbox/Switch-ui-catchall-tests-split-by-helper-and-hook-functio.md`)

Split the remaining UI catchall tests by semantic functionality. DOM helper assertions were merged into `selection-helpers.test.ts` or moved to new `theme-runtime.test.ts` and `reader-highlight-marks.test.ts`. React hook behavior assertions were moved into focused hook files (`load-more-list-hook`, `keyboard-shortcut-hook`, `focus-trap-hook`, `roving-tabindex-hook`, `current-reading-block-hook`, `tts-prose-highlight-hook`) instead of merging into existing pure/export tests, because each hook behavior suite needs an isolated React module mock harness and keeping that harness separate avoids destabilizing existing semantic tests. The original catchall files `tests/ui-hooks.test.ts` and `tests/ui-dom-helpers.test.ts` were deleted after all assertions were relocated.

### 2026-07-02T04-33-26: Continuous TTS backfill via batch-synthesis --loop (speech:keep) drains the 11k-article narration backlog + word boundaries
**By:** Mouse
**What:** Continuous TTS backfill via batch-synthesis --loop (speech:keep) drains the 11k-article narration backlog + word boundaries
**Why:** The reader "Listen + word highlight" feature was already fully built (ArticleSpeech.words V2 timing JSON, ReaderListenButton, useTtsProseHighlight/useActiveWord, speech API + audio route). The only gap for "keeps creating" was a continuous generator: 11,168 published/public articles had 0 ArticleSpeech rows.

Decision: add a continuous loop mode to the existing Azure Batch Synthesis pipeline (scripts/batch-synthesis.ts) rather than a job-queue backfill, because Azure Batch Synthesis is purpose-built for high-volume async TTS (up to 1000 inputs/job) and the script already persists audio + word boundaries via saveSpeechResult. Each pass re-queries `speech IS NULL`, so it drains the backlog and auto-picks-up newly scraped articles.

New flags: --loop, --sleep <ms> (default 60000), --max-passes <n> (0=unlimited), --max-errors <n> (default 5). Per-pass --limit defaults to 50 in loop mode. Graceful shutdown via registerShutdownSignals. New npm script: speech:keep = "speech:batch -- --all --loop". runOnce/runLoop extracted; non-loop behavior unchanged.

Verified: tsc clean, eslint clean, 5/5 new tests (tests/batch-synthesis.test.ts), and a real Azure run generated audio + word boundaries for 2 articles (words=1715 & 3620), draining sequentially and exiting on --max-passes. Files: scripts/batch-synthesis.ts, package.json, tests/batch-synthesis.test.ts, docs/operations/tts-jobs.md.

Note (not a blocker): MEDIA_STORAGE=local is not a recognized object-storage kind, so audio persists as base64 in the DB (~2-6MB/article). Configure Azure Blob object storage before the full 11k backfill to avoid DB bloat.
### 2026-07-02T04-53-31: MEDIA_STORAGE=local is now a supported alias for the filesystem media-storage backend (local directory under MEDIA_STORAGE_DIR)
**By:** Tank
**What:** MEDIA_STORAGE=local is now a supported alias for the filesystem media-storage backend (local directory under MEDIA_STORAGE_DIR)
**Why:** User had MEDIA_STORAGE=local in .env, but the config parser only recognized database|filesystem|azure, so it logged storage.unknown_kind and fell back to DB base64 (audio stored inline, ~2-6MB/article).

Decision: treat `local` as an ALIAS for the existing `filesystem` backend rather than adding a new MediaStorageKind or duplicating FilesystemMediaStorage. The filesystem backend (src/lib/storage/filesystem.ts) already implements the MediaStorage interface, is content-addressed + traversal-safe, and is backed by MEDIA_STORAGE_DIR (default ./.media).

Changes (2 raw-env branches, both centralized): src/lib/runtime-config/storage.ts mediaStorageKind() now returns "filesystem" for raw "filesystem" or "local"; src/lib/runtime-config/runtime.ts readiness validation treats "local" like "filesystem" (status=configured). The internal MediaStorageKind union stays database|filesystem|azure — `local` is user-facing input sugar. Docs (docs/media/storage.md) + .env.example + tests/storage-config.test.ts updated.

Verified end-to-end: MEDIA_STORAGE=local → getMediaStorage().kind=filesystem at ./.media; a real Azure batch generation persisted audio to disk with storageKey + a MediaAsset row (audioBase64 null); read-back returns valid MP3; migrate-storage moved 2 leftover base64 rows to disk (all 3 ArticleSpeech rows now filesystem-backed, 3 files/13MB on disk). 50/50 storage+config tests pass, tsc + eslint clean. This resolves the DB-bloat risk flagged for the 11k TTS backfill.
