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

## Archived 2026-07-12T02:41:59.148+00:00

### 2026-07-03T00-59-28: Frontend refactor limited to target component files
**By:** Trinity
**What:** Frontend refactor limited to target component files
**References:** Ralph Agent request, src/components/reader/wordLookup/WordLookup.tsx, src/components/command/CommandPalette.tsx, src/components/pronunciation/usePronunciationSession.ts, src/components/reader/study/useArticleQuizPanel.ts
**Why:** Performed a behavior-preserving refactor pass only in the requested frontend targets. Extracted repeated selection/lookup helpers in WordLookup, row rendering and announcement helpers in CommandPalette, microphone error classification helpers in usePronunciationSession, and quiz scoring/submission helpers in useArticleQuizPanel. Preserved routes, API endpoints, form fields, focus/keyboard behavior, selection/highlight semantics, and design-system token usage. Validation passed with targeted ESLint and full TypeScript typecheck.

### 2026-07-03T00-59-33: Backend/runtime utility refactor completed
**By:** Tank
**What:** Backend/runtime utility refactor completed
**References:** Ralph Agent, src/lib/offline/sync-runtime.ts, src/lib/difficulty.ts, src/lib/import/url-import.ts, src/lib/storage/azure.ts
**Why:** Performed a behavior-preserving refactor pass limited to src/lib/offline/sync-runtime.ts, src/lib/difficulty.ts, src/lib/import/url-import.ts, and src/lib/storage/azure.ts. Extracted small helpers for duplicated send/retry/status logic, cached difficulty result construction/persistence fields, URL import dependency resolution/scrape handling/duplicate result construction, and Azure error/stream/service-client handling. Public behavior, routes, schemas, generated/data files, and provider fallback semantics were intentionally left unchanged. Validation passed: targeted node tests for difficulty, URL import/import service, offline sync runtime, Today replay, and Azure storage (87 passed), plus npm run typecheck -- --pretty false (exit 0).

### 2026-07-03T00-59-36: Kept scraper refactor surgical and behavior-preserving
**By:** Mouse
**What:** Kept scraper refactor surgical and behavior-preserving
**References:** Ralph Agent, src/lib/scraper/declutter.ts, src/lib/scraper/extract.ts, src/lib/scraper/quality.ts, scripts/scrape-smithsonian.ts
**Why:** Refactored only the requested scraper/ingestion targets by extracting existing selection/counting/type helpers and reusing existing quality-check seams. Preserved extraction choice thresholds, declutter candidate ordering, Smithsonian scrape outcome semantics, publishing behavior, provider fallbacks, and logging/redaction behavior. Validation passed with focused node tests for declutter/extract/quality/Smithsonian CLI plus targeted ESLint on touched files.

### 2026-07-03T01-04-54: APPROVE first combined refactor batch
**By:** Switch
**What:** APPROVE first combined refactor batch
**References:** Ralph Agent, refactor batch 1
**Why:** APPROVE. Reviewed the first combined refactor batch limited to: scripts/scrape-smithsonian.ts, src/components/command/CommandPalette.tsx, src/components/pronunciation/usePronunciationSession.ts, src/components/reader/study/useArticleQuizPanel.ts, src/components/reader/wordLookup/WordLookup.tsx, src/lib/difficulty.ts, src/lib/import/url-import.ts, src/lib/offline/sync-runtime.ts, src/lib/scraper/declutter.ts, src/lib/scraper/extract.ts, src/lib/scraper/quality.ts, src/lib/storage/azure.ts.

Findings: no blocking behavior changes, broken imports/types, provider fallback regressions, UI behavior regressions, or privacy/logging regressions found. Changes appear to be helper extraction and local type cleanup while preserving existing control flow.

Validation independently run:
- IDE diagnostics for each changed file: no diagnostics.
- npx eslint scripts/scrape-smithsonian.ts src/components/command/CommandPalette.tsx src/components/pronunciation/usePronunciationSession.ts src/components/reader/study/useArticleQuizPanel.ts src/components/reader/wordLookup/WordLookup.tsx src/lib/difficulty.ts src/lib/import/url-import.ts src/lib/offline/sync-runtime.ts src/lib/scraper/declutter.ts src/lib/scraper/extract.ts src/lib/scraper/quality.ts src/lib/storage/azure.ts: exit 0.
- npm run typecheck: exit 0.
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-smithsonian-cli.test.ts tests/difficulty.test.ts tests/difficulty-ai-assessment.test.ts tests/import-url.test.ts tests/offline-runtime.test.ts tests/sync-runtime-errors.test.ts tests/offline-sync.test.ts tests/scraper-declutter.test.ts tests/scraper-extractor.test.ts tests/scraper-jsonld-image-recovery.test.ts tests/scraper-extract-readability-comparison.test.ts tests/scraper-quality.test.ts tests/scraper-quality-checks.test.ts tests/azure-storage.test.ts tests/storage-azure-provider.test.ts tests/command-navigation.test.ts: 215 passed, 0 failed.

# Tank speech refactor

- Refactored only the requested target files; all target files were clean before editing.
- Preserved Azure graceful fallback behavior: provider still returns null for SDK failures/timeouts and keeps existing timeout race semantics.
- Preserved timing/audio persistence semantics: repository storage checks, media asset/article speech upsert fields, V2 timing payload shape, and text-span inclusion rules remain unchanged.
- Preserved word-boundary alignment behavior while extracting reusable helpers for boundary matching, text-span parsing, batch word parsing, and CLI flag classification.
- Validation: targeted node tests for speech provider/timing/repository/batch/migration/json passed (41/41). Full `npm run typecheck -- --pretty false` still fails in unrelated `tests/scraper-rss-extractor.test.ts:95` with an existing ExtractorFetch return-type mismatch.

# Switch test refactor pass

- Target files were unmodified at task start; existing non-target worktree changes were left untouched.
- Refactored only the four allowed test files:
  - `tests/scraper-rss-extractor.test.ts`: centralized enabled discovery setup and feed-map fetch fixtures.
  - `tests/scripts-scrapers.test.ts`: added local state-path, visited-record, and Prisma count queue helpers.
  - `tests/routes-api-fallbacks.test.ts`: added local route context/API-error helpers and push subscription helper to remove repeated setup.
  - `tests/server-read-models-runtime.test.ts`: added article-find queue and retry sleep helpers.
- Preserved mocked providers, fixture behavior, assertions, and coverage intent; no source files were edited.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scripts-scrapers.test.ts tests/scraper-rss-extractor.test.ts tests/routes-api-fallbacks.test.ts tests/server-read-models-runtime.test.ts` (49 tests passed, 0 failed).

# Trinity frontend refactor pass 2

- Refactored only the allowed target files that were clean before editing.
- Kept behavior stable: routes, API endpoints, payloads, form fields, a11y labels, focus/key handling, and reader/tutor semantics were preserved.
- Chose small extraction/constant passes over component rewrites: query-string construction in `VocabularyJournal`, transient row rendering in `ArticleTutor`, offline URL/error helpers in `OfflineDownloadButton`, speech/remove helpers in `StudyList`, and import body/error/redirect constants in `ImportForm`.
- Validation completed with targeted ESLint: `npx eslint src/components/ArticleTutor.tsx src/components/VocabularyJournal.tsx src/components/StudyList.tsx src/components/OfflineDownloadButton.tsx 'src/app/(app)/import/ImportForm.tsx'` (exit 0).

# Mouse ingestion refactor 2

Date: 2026-07-03T01:05:55Z
Author: Mouse
Requested by: Ralph Agent

## Decisions

- Refactored only the requested target files: `scripts/scrape-undark.ts`, `scripts/scrape-review.ts`, `scripts/build-quality-corpus.ts`, and `scripts/process.ts`.
- Kept behavior-preserving changes surgical: extracted helpers for process flow, review URL/feedback/server seams, Undark outcome accounting, and corpus-builder quality/capping/write-path calculations.
- Preserved all CLI flags, discovery choices, retry/retryable-failure accounting, saved/duplicate/failure counters, publish behavior, and privacy/logging constraints. No article text, prompts, secrets, or private content were added to logs or metadata.
- Did not run the live corpus builder because it performs network harvesting and writes the generated corpus outside the allowed target files. Used lint, targeted tests, and full TypeScript typecheck instead.
- Did not commit, branch, reset, or hand-write mutable `.squad` state.

## Validation

- `npx eslint scripts/process.ts scripts/scrape-undark.ts scripts/scrape-review.ts scripts/build-quality-corpus.ts` — passed, exit 0.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test --test-reporter=dot tests/cli-utils.test.ts tests/scrape-review.test.ts tests/scraper-undark-cli.test.ts tests/scripts-scrapers.test.ts tests/scripts-operational.test.ts` — passed, exit 0.
- `npx tsc --noEmit --incremental false --pretty false` — passed, exit 0.

# switch-test-refactor-3

Author: Switch
Date: 2026-07-03T01:15:44.179+00:00
Requested by: Ralph Agent

## Decision

Performed behavior-preserving refactors in the four approved, previously untouched test files only. Changes were limited to local helper extraction and duplication reduction:

- `tests/scraper-quality-checks.test.ts`: extracted digest roundup fixture generation and classifier env restoration helper.
- `tests/jobs-org-analytics-backend.test.ts`: extracted organization fixture and membership-key helper.
- `tests/article-library-read-models.test.ts`: extracted default reading-list fixture builder.
- `tests/offline-runtime.test.ts`: extracted repeated service-worker navigator setup.

No source files were edited and no commit was created.

## Validation

Command:

```sh
NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-quality-checks.test.ts tests/jobs-org-analytics-backend.test.ts tests/article-library-read-models.test.ts tests/offline-runtime.test.ts
```

Result: passed, 67 tests; 0 failures.

# Tank engagement/api backend refactor

- Refactored only clean target files: `src/lib/feed.ts`, `src/lib/api-handler.ts`, `src/lib/engagement/today-session/completion.ts`, `src/lib/engagement/today-session/comprehension.ts`, and `src/lib/learning/study-plan-engine.ts`.
- Kept behavior/API contracts unchanged: public exports, recommendation/session completion rules, request-id/security handling, analytics privacy payloads, and graceful fallbacks are preserved.
- Extracted small local helpers for repeated request-id, feed reason/fallback, Today session lookup, comprehension grading/remediation, and study-plan confidence/coach-memory shaping logic.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/feed.test.ts tests/sources-feed-discovery.test.ts tests/api-handler.test.ts tests/today-session-completion.test.ts tests/today-comprehension.test.ts tests/today-comprehension-edges.test.ts tests/study-plan.test.ts` (100/100 pass) and `npx eslint src/lib/feed.ts src/lib/api-handler.ts src/lib/engagement/today-session/completion.ts src/lib/engagement/today-session/comprehension.ts src/lib/learning/study-plan-engine.ts` (pass).

# Trinity UI refactor pass 3

- Target files were unmodified before this pass; edits were limited to the requested targets.
- Refactors are behavior-preserving: extracted list URL/active-state helpers and shared mobile list handlers, named the level recommendation confidence threshold, isolated placement URL/scoring helpers, centralized highlights endpoint/lookup/optimistic-highlight helpers, and extracted filtered-fetch timer/abort helpers.
- No UI behavior, routes, API calls, form fields, focus/keyboard semantics, or reader highlight behavior were intentionally changed.
- Validation: `npx eslint --no-warn-ignored src/components/ListSwitcher.tsx src/components/LevelRecommendationBanner.tsx src/components/placement/ReadingPlacementCard.tsx src/components/reader/useHighlightsApi.ts src/hooks/useFilteredFetch.ts` passed. `npm run typecheck` failed on pre-existing unrelated `src/lib/learning/study-plan-engine.ts(336,57)` Map key typing error; IDE diagnostics for all five touched files returned no issues. `git diff --check -- <targets>` passed.

### 2026-07-03T01-40-35: morpheus-refactor-review-batches-2-3: REJECT
**By:** Morpheus
**What:** morpheus-refactor-review-batches-2-3: REJECT
**References:** Ralph Agent, batches two and three, src/lib/learning/study-plan-engine.ts, src/lib/learning/coach-memory.ts
**Why:** # Verdict: REJECT

## Findings

1. Blocking typecheck regression in `src/lib/learning/study-plan-engine.ts`.
   - `applyCoachMemoryToSkills` was extracted with parameter `coachConfidences: Map<Skill, number>` at `src/lib/learning/study-plan-engine.ts:259-262`.
   - The unchanged provider `coachMemorySkillConfidences` returns `Promise<Map<string, number>>` at `src/lib/learning/coach-memory.ts:286-295`.
   - The call at `src/lib/learning/study-plan-engine.ts:336` now fails TypeScript with TS2345.
   - This is caused by the current refactor extraction because the explicit `Map<Skill, number>` annotation is new in the current diff; the previous inline logic accepted the inferred `Map<string, number>`.
   - Must be fixed before proceeding because the repository typecheck gate fails.

No other blocking issues were found in the reviewed changed artifacts. Focused behavior tests passed for changed test files and study-plan/coach-memory coverage.

## Validation

- `npm run typecheck` — FAILED:
  - `src/lib/learning/study-plan-engine.ts(336,57): error TS2345: Argument of type 'Map<string, number>' is not assignable to parameter of type 'Map<"vocabulary" | "reading" | "comprehension" | "grammar" | "listening" | "pronunciation", number>'.`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/study-plan.test.ts tests/coach-memory.test.ts` — PASSED, 37/37.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/article-library-read-models.test.ts tests/jobs-org-analytics-backend.test.ts tests/offline-runtime.test.ts tests/routes-api-fallbacks.test.ts tests/scraper-quality-checks.test.ts tests/scraper-rss-extractor.test.ts tests/scripts-scrapers.test.ts tests/server-read-models-runtime.test.ts` — PASSED, 116/116.

## Recommended fix owner

Assign a different fix agent than the original author, e.g. Trinity, to align the map type contract without changing runtime behavior. The smallest safe fix is to make `applyCoachMemoryToSkills` accept the actual return type (`Map<string, number>`) or otherwise tighten `coachMemorySkillConfidences` end-to-end if all keys are validated.

## Recommended next batch focus

Pause further refactor batches until the typecheck regression is corrected and `npm run typecheck` passes. Then continue with behavior-preserving extractions in areas already covered by focused tests, keeping provider fallback paths unchanged.

# Trinity study-plan type fix

- Timestamp: 2026-07-03T01:40:57.128+00:00
- File changed: `src/lib/learning/study-plan-engine.ts`
- Decision: keep `coachMemorySkillConfidences` as the source of `Map<string, number>` and make the private `applyCoachMemoryToSkills` helper accept `ReadonlyMap<string, number>` because it only probes known `SkillSummary.skill` keys and ignores non-core coach-memory dimensions such as `main_idea`/`inference`.
- Safety: removed the helper's non-null `Map.get(...)!` by reading once and preserving fallback behavior when no core skill confidence is present.
- Validation passed:
  - `npm run typecheck -- --pretty false`
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/study-plan.test.ts tests/coach-memory.test.ts`

### 2026-07-03T02-01-30: APPROVE refactor rereview after study-plan type regression fix
**By:** Morpheus
**What:** APPROVE refactor rereview after study-plan type regression fix
**References:** Ralph Agent, Trinity, src/lib/learning/study-plan-engine.ts, tests/study-plan.test.ts
**Why:** Verdict: APPROVE

Findings:
- Typecheck is green.
- src/lib/learning/study-plan-engine.ts fix is behavior-preserving and type-safe: extracted confidenceGap/confidenceEvidence/applyCoachMemoryToSkills/readingRecFromTopPick preserve prior branches, avoid non-null assertion on Map#get, and keep SkillMastery fallback when coach memory is empty.
- No new obvious refactor safety issues found in the changed set; independent code-review subagent also returned APPROVE.

Validation:
- npm run typecheck -- --pretty false => exit 0; tsc --noEmit --pretty false passed.
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/study-plan.test.ts => exit 0; 14 tests passed, 0 failed.
- git --no-pager diff --check => exit 0; no whitespace errors.
- npm test -- tests/study-plan.test.ts => exit 0, but package script includes tests/**/*.test.ts so this was broader than needed.

Refactoring may continue.

# Switch test refactor 4

- Scope: behavior-preserving refactor pass on target test files only.
- Edited targets: `tests/providers.test.ts`, `tests/today-comprehension.test.ts`, `tests/scraper-fetch-strategies.test.ts`, `tests/scraper-declutter.test.ts`.
- Meaningful decisions:
  - Kept source files untouched and edited only target tests that were clean at start.
  - Extracted local helpers/builders for repeated category assertions, quiz-question fixtures, comprehension-completion assertion, fetch env setup/counting, and body prose insertion.
  - Preserved assertion intent, mocked seams, fixtures, privacy checks, fallback-chain semantics, and edge-case coverage.
- Validation: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/providers.test.ts tests/today-comprehension.test.ts tests/scraper-fetch-strategies.test.ts tests/scraper-declutter.test.ts`
- Result: pass — 118 tests, 118 passed, 0 failed.

# Tank processing/AI refactor 4

- Refactored only allowed untouched targets: processing backfill/processor, AI budget, lexical normalize, article-library policy.
- Preserved public exports and behavior: changes extract small helpers/constants, centralize repeated predicates/decision builders, and keep processing/backfill ordering and optional provider fallback paths unchanged.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/backfill.test.ts tests/processing-pipeline.test.ts tests/processor-metrics.test.ts tests/ai-budget.test.ts tests/ai-budget-shared-store.test.ts tests/lexical-normalize.test.ts tests/article-access.test.ts tests/article-visibility-regressions.test.ts tests/article-library-read-models.test.ts` (85/85 passing); `npx eslint src/lib/processing/backfill.ts src/lib/processing/processor.ts src/lib/ai/budget.ts src/lib/lexical/normalize.ts src/lib/article-library/policy.ts` (passed).

# Mouse scraper fetch/cleanup/provider refactor 4

Timestamp: 2026-07-03T02:05:10Z
Author: Mouse
Requested by: Ralph Agent

## Decision
Performed a behavior-preserving refactor pass only in the allowed scraper files:
- `src/lib/scraper/fetch-strategies.ts`
- `src/lib/scraper/cleanup.ts`
- `src/lib/scraper/sources.ts`
- `src/lib/scraper/providers/knowable.ts`
- `src/lib/scraper/providers/nautilus.ts`

## Rationale
- Preserved fetch strategy order, host strategy memory ordering, 429 same-strategy retry behavior, reader/Wayback fallback behavior, provider discovery behavior, cleanup semantics, and existing redacted reader auth handling.
- Kept changes surgical: extracted small helpers for status checks, remembered-strategy promotion, cleanup keyword normalization, source counter mapping, Knowable paged RSS traversal, and Nautilus bounded URL appends.
- No files outside the allowed target set were edited by this pass.

## Validation
- `npx eslint src/lib/scraper/fetch-strategies.ts src/lib/scraper/cleanup.ts src/lib/scraper/sources.ts src/lib/scraper/providers/knowable.ts src/lib/scraper/providers/nautilus.ts` — passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-fetch-strategies.test.ts tests/scraper-fetch-strategies-edges.test.ts tests/scraper-cleanup.test.ts tests/scraper-cleanup-parse-fallback.test.ts tests/scraper-knowable.test.ts tests/nautilus-wp.test.ts tests/content-sources.test.ts` — 89 passed, 0 failed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test --test-name-pattern='knowable discovery|nautilus' tests/scraper-rss-extractor.test.ts` — 6 passed, 0 failed.

No production build run. Typecheck not run because no shared contracts or generated/schema types changed.

# Morpheus Review: Refactor Batch 4

Verdict: APPROVE

Findings: No blocking issues found in the reviewed batch-four files. Changes appear behavior-preserving, type-safe, and covered by adjacent tests. Provider fallback/retry/discovery, processing/backfill, AI budget, lexical normalization, article access policy, and test-helper refactors did not show semantic drift.

Validation:
- `git --no-pager diff --check` — passed (exit 0)
- `npm run typecheck -- --pretty false` — passed (exit 0)
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/providers.test.ts tests/today-comprehension.test.ts tests/scraper-fetch-strategies.test.ts tests/scraper-declutter.test.ts` — passed, 118/118
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/ai-budget.test.ts tests/ai-budget-shared-store.test.ts tests/lexical-normalize.test.ts tests/article-access.test.ts tests/article-visibility-regressions.test.ts tests/processing-pipeline.test.ts tests/processor-metrics.test.ts tests/backfill.test.ts tests/scraper-cleanup.test.ts tests/content-sources.test.ts tests/scraper-knowable.test.ts tests/nautilus-wp.test.ts tests/scraper-fetch-strategies-edges.test.ts` — passed, 141/141

Recommended next batch focus: continue with remaining scraper/import/feed and UI-adjacent refactors; prioritize boundary tests around provider discovery/fallbacks and private-content privacy logging constraints.

# Trinity reader/practice refactor pass 5

- Timestamp: 2026-07-03T02:12:34.903+00:00
- Scope: behavior-preserving refactors limited to the requested untouched target files.
- Decisions:
  - Kept reader/practice behavior, routes, API calls, form fields, and focus semantics unchanged.
  - Extracted repeated presentational/types-only structure in dictation, pronunciation, Today workflow, and list picker code instead of changing hooks or data contracts.
  - Removed unused notes-panel color-update wiring only because the row color picker is not rendered; the exported highlight colors remain available.
- Validation: `npx eslint -- src/components/ArticleDictation.tsx src/components/ArticlePronunciation.tsx 'src/app/(app)/today/_components/TodayWorkflow.tsx' src/components/ListPickerPopover.tsx src/components/reader/ReaderNotesPanel.tsx` passed with exit code 0.

# Tank backend refactor 5

- Refactored only untouched target backend files: account commands, recommendation scoring, coach memory, and audit logging.
- Left `src/lib/rbac.ts` untouched because the current capability table and helpers are already clear and covered; changing it would add churn without maintainability gain.
- Kept behavior-preserving boundaries: no public export changes, no authorization/account lifecycle semantic changes, no privacy/redaction changes, no recommendation scoring changes, and storage/provider fallbacks remain best-effort.
- Validation passed:
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/account.test.ts tests/account-export.test.ts tests/recommendations.test.ts tests/weak-word-reexposure.test.ts tests/coach-memory.test.ts tests/audit.test.ts tests/retention.test.ts tests/redaction.test.ts` → 127 passed, 0 failed.
  - `npx eslint src/lib/account-lifecycle/account-commands.ts src/lib/recommendations/scoring.ts src/lib/learning/coach-memory.ts src/lib/security/audit.ts` → passed.

# Switch test refactor pass 5

- Date: 2026-07-03
- Scope: behavior-preserving refactor of untouched target test files only.
- Files edited:
  - `tests/today-session-completion.test.ts`
  - `tests/cli-utils.test.ts`
  - `tests/import-service.test.ts`
  - `tests/session-push-speech-worker.test.ts`
  - `tests/article-library-admin.test.ts`

## Decisions

- Kept changes limited to local test helpers, builders, constants, and duplicated assertion reduction.
- Preserved existing assertions, mocked boundaries, fixtures, and edge-case semantics.
- Did not touch source files or pre-existing modified non-target files.

## Validation

Command:

```sh
NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/today-session-completion.test.ts tests/cli-utils.test.ts tests/import-service.test.ts tests/session-push-speech-worker.test.ts tests/article-library-admin.test.ts
```

Result: passed — 133 tests, 13 suites, 0 failures.

Additional check: `git --no-pager diff --check -- <target files>` passed with no whitespace errors.

# Mouse tooling refactor 5

- Refactored target operational tooling/provider files only; verified none of the targets were modified before editing.
- Preserved CLI flags/output contracts, API catalog shape, coverage thresholds, scraper discovery/cleanup behavior, and logging/redaction by extracting helpers without changing control flow or data shapes.
- Changed files: `src/tools/api-catalog.ts`, `scripts/analyze-speech-alignment.ts`, `scripts/check-node-coverage.ts`, `scripts/scrape.ts`, `src/lib/scraper/providers/smithsonian.ts`.
- Validation passed:
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/api-catalog-generation.test.ts tests/api-catalog-drift.test.ts tests/coverage-gate.test.ts tests/scripts-scrapers.test.ts tests/scraper-providers-discovery.test.ts tests/scraper-cleanup.test.ts tests/providers.test.ts --test-name-pattern "api catalog|api-catalog|coverage gate|scrape\\.ts|Smithsonian|smithsonian"` — 99 passed, 0 failed.
  - `npm run typecheck` — passed.
  - `npx eslint src/tools/api-catalog.ts scripts/analyze-speech-alignment.ts scripts/check-node-coverage.ts scripts/scrape.ts src/lib/scraper/providers/smithsonian.ts` — passed.

# APPROVE — Refactor batch five review

Requested by: Ralph Agent
Reviewer: Morpheus
Reviewed at: 2026-07-03T02:18:00Z

## Findings

No blocking findings. The batch appears behavior-preserving across account lifecycle cleanup, recommendation scoring, coach memory, audit metadata redaction/retention helpers, UI extraction, API catalog generation, scraper/tooling refactors, and test helper rewrites.

## Validation

- `git --no-pager diff --check` — PASS (exit 0)
- `npm run typecheck -- --pretty false` — PASS (exit 0)
- `npx eslint <batch-five-files>` — PASS (exit 0)
- Focused node tests for account lifecycle/export, recommendations, weak-word re-exposure, coach memory, audit/redaction, coverage gate, API catalog generation, Smithsonian discovery, and changed tests — PASS (exit 0)
- `tests/api-catalog-drift.test.ts` — PASS (6/6)

## Recommended next batch focus

Prioritize high-risk shared service seams and user-private data paths: import/processing, speech storage/timing, offline sync, scraper extraction/cleanup, and route fallback/auth helpers. Keep privacy/redaction and output-contract tests close to any further extraction.

# Tank service refactor 6

- Refactored only the requested service seam files and left public exports/contracts unchanged.
- Kept Today session semantics intact by extracting step builders without changing CTA/progress/reflection behavior.
- Kept lexical provider fallback behavior intact by extracting parsing helpers only; provider order and graceful null-on-failure behavior are unchanged.
- Kept series enrollment semantics intact by extracting visibility and enrollment update helpers while preserving monotonic nextIndex advancement/completion.
- Kept article admin visibility and privacy semantics intact by extracting status normalization, row/count mapping, and AI-derivative clearing helpers behind the existing admin-visible guards.
- Kept admin tag visibility semantics intact by centralizing public-tag filtering and row mapping for the read model.

Validation:
- `npx eslint src/lib/engagement/today-session/view-model.ts src/lib/lexical/provider.ts src/lib/engagement/series.ts src/lib/article-library/admin.ts src/lib/article-library/admin-tags.ts` — passed.
- `mkdir -p .test-tmp && TMPDIR="$PWD/.test-tmp" NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/today-view-model.test.ts tests/lexical-provider.test.ts tests/series-access.test.ts tests/engagement-data-read-models.test.ts tests/article-library-admin.test.ts tests/admin-tag-commands.test.ts tests/article-library-read-models.test.ts; status=$?; rm -rf .test-tmp; exit $status` — passed, 88/88 tests.

# Mouse scraper provider refactor 6

- Refactored only untouched allowed existing target files: `src/lib/scraper/providers/noema.ts`, `src/lib/scraper/providers/undark.ts`, and `src/lib/scraper/wp-api.ts`.
- Left `src/lib/scraper/providers/quanta.ts` and `src/lib/scraper/providers/aeon.ts` untouched because they do not exist in this worktree; `aeon` is explicitly removed/unregistered in provider tests.
- Preserved behavior by extracting local helper functions only: Noema now reuses the shared sitemap parser and isolates candidate collection; Undark isolates API URL construction, discovery limits, and URL normalization; Nautilus WP API isolates URL building, JSON parsing, and link appending.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-rss-extractor.test.ts tests/scraper-providers-discovery.test.ts tests/nautilus-wp.test.ts tests/scraper-noema.test.ts` (86 passed, 0 failed).
- Lint passed: `npx eslint src/lib/scraper/providers/noema.ts src/lib/scraper/providers/undark.ts src/lib/scraper/wp-api.ts`.

# Trinity admin/reader refactor 6

- Edited only the requested untouched target files; existing unrelated worktree modifications were left untouched.
- Admin article detail: consolidated article-library imports, named badge/status mapping helpers, precomputed moderation option lists, extracted review-change formatting, and normalized admin table structure/indentation without changing routes, API calls, form fields, or rendered data.
- Admin AI analytics: named repeated heading classes/default window value, extracted compact-id formatting, and normalized table markup while preserving query params, routes, and displayed values.
- BilingualBody: extracted localStorage prefs validation, DOM selectors, timeout, translation cleanup, and paragraph creation helpers; removed an unread ref while preserving bilingual fetch, selection/highlight behavior, and safe text-only injection.
- AccountDangerZone and ClearLearningMemory: extracted fallback error-message helpers only; API calls, confirmation flows, loading, and success/error semantics are unchanged.
- Validation: `git --no-pager diff --check -- ...` passed; `npx eslint -- src/app/admin/articles/[id]/page.tsx src/app/admin/analytics/ai/page.tsx src/components/reader/BilingualBody.tsx src/components/ClearLearningMemory.tsx src/components/AccountDangerZone.tsx` passed.

# Switch test refactor pass 6

- Date: 2026-07-03T02:21:45Z
- Author: Switch
- Scope: behavior-preserving refactor of allowed untouched test files only.

## Decisions

- Refactored only the five assigned target files: `tests/redaction.test.ts`, `tests/recommendations.test.ts`, `tests/scraper-quality.test.ts`, `tests/activity.test.ts`, and `tests/reader-prefs.test.ts`.
- Left source files and other pre-existing worktree modifications untouched.
- Preserved assertions, fixtures, mocks, edge-case semantics, and native Node test coverage intent while extracting local helpers/builders for repeated test setup.

## Validation

Command:

```bash
NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/redaction.test.ts tests/recommendations.test.ts tests/scraper-quality.test.ts tests/activity.test.ts tests/reader-prefs.test.ts
```

Result: pass — 148 tests passed, 0 failed.

# Morpheus Review: Refactor Batch 6

Verdict: APPROVE

Findings: None blocking. Reviewed changed batch files for behavior-preserving refactors, type/import safety, read-model contracts, lexical/provider fallback behavior, engagement/session behavior, article admin visibility, scraper provider discovery, UI behavior, and test refactor correctness.

Validation:
- `git --no-pager diff --check` — PASS (exit 0)
- `npm run typecheck -- --pretty false` — PASS (exit 0)
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/redaction.test.ts tests/recommendations.test.ts tests/scraper-quality.test.ts tests/activity.test.ts tests/reader-prefs.test.ts` — PASS (148 tests)
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/today-view-model.test.ts tests/series-today-candidate.test.ts tests/lexical-provider.test.ts tests/article-library-admin.test.ts tests/admin-article-read-models.test.ts tests/article-visibility-regressions.test.ts tests/scraper-providers-discovery.test.ts tests/scraper-noema.test.ts` — PASS (113 tests)

Recommended next batch focus: continue with adjacent scraper/provider and admin read-model refactors, keeping provider fallback paths and article visibility policy covered by focused tests.

# Switch test refactor 7

- Refactored only the requested clean target tests: `tests/import-boundary.test.ts`, `tests/scripts-operational.test.ts`, `tests/account-export.test.ts`, `tests/scraper-providers-discovery.test.ts`, and `tests/feed.test.ts`.
- Kept changes behavior-preserving: extracted local helpers for repeated lint assertions/config, account lifecycle imports, logger assertions, shared scraper failure fallback checks, and feed scoring fixtures/context.
- Did not edit source files, non-target tests, or already-modified worktree files.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/import-boundary.test.ts tests/scripts-operational.test.ts tests/account-export.test.ts tests/scraper-providers-discovery.test.ts tests/feed.test.ts` => 80 tests passed, 0 failed.

# Mouse scraper/import/runtime refactor pass

- Refactored only the allowed untouched target files: `src/lib/scraper/providers/natgeo.ts`, `src/lib/scraper/providers/technologyreview.ts`, `src/lib/runtime-config/runtime.ts`, `src/lib/ai/chunking.ts`, and `src/lib/offline/registry.ts`.
- Preserved provider URL normalization, article filtering, discovery ordering/fallbacks, runtime config defaults/fallbacks, storage warning codes/messages, chunking budgets/overlap behavior, and offline mutation privacy/lookup semantics.
- Extracted duplicated article-candidate append helpers for NatGeo and MIT Technology Review, centralized Technology Review sitemap host/path checks, split runtime storage/tuning report construction into helpers/constants, clarified chunk token summing/word-piece naming, and shared offline registry lookup through one helper.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/providers.test.ts tests/scraper-providers-discovery.test.ts tests/config-runtime-env.test.ts tests/config.test.ts tests/storage-config.test.ts tests/ai-chunking.test.ts tests/offline-registry.test.ts` (92 pass, 0 fail) and `npx eslint --quiet src/lib/scraper/providers/natgeo.ts src/lib/scraper/providers/technologyreview.ts src/lib/runtime-config/runtime.ts src/lib/ai/chunking.ts src/lib/offline/registry.ts` (exit 0).

# Tank backend refactor 7

- Refactored only the requested, initially-clean target files.
- Preserved public exports and behavior while extracting shared private helpers for tag scoping/link reconciliation, AI cache call-model construction/article loading, AI facade ledger/budget helpers, content-ops aggregation mapping, and RBAC capability groups.
- Left logging/redaction semantics unchanged: AI facade helpers still record only metadata and continue background quota fallback behavior.
- Validation: targeted node tests for RBAC, AI facade/cache, admin ops, tags, and article-library read models passed (52/52); ESLint passed for the five touched files; full `npm run typecheck` still fails on pre-existing `tests/import-boundary.test.ts` ESLint config typing errors, with IDE diagnostics clean for touched files.

# Trinity UI refactor 7

- Refactored only the five requested untouched target files; did not touch currently modified worktree files outside the allowed set.
- Preserved behavior by extracting helper functions/constants only: TTS CSS Highlight lifecycle/scroll thresholds, quiz option state/history limit, article CEFR/new-article helpers, Today comprehension payload/card helpers, and admin article difficulty/byline helpers.
- Validation passed: `npx eslint -- src/components/reader/wordLookup/useTtsProseHighlight.ts src/components/ArticleQuiz.tsx src/components/ArticleCardView.tsx 'src/app/(app)/today/_components/TodayComprehensionCheck.tsx' src/app/admin/articles/page.tsx`; TTS prose highlight tests; Today comprehension tests; `git diff --check` for target files.
- Full `npm run typecheck -- --pretty false` was attempted and failed only in existing `tests/import-boundary.test.ts` ESLint config typings, unrelated to the touched files.

# Morpheus Review: Refactor Batch 7

Verdict: APPROVE

Requested by: Ralph Agent
Reviewed at: 2026-07-03T00:53:11.812+00:00

## Findings

No blocking findings. The batch-seven changes are behavior-preserving refactors across article tag scoping/reconciliation, admin processing dashboards, RBAC capability grouping, AI facade/cache helpers, TTS prose highlighting, article quiz/card UI, Today comprehension submission payloads, admin article table rendering, scraper provider candidate collection, runtime storage/tuning config, AI chunking, offline mutation registry, and the focused import-boundary test type fix.

Security/RBAC/article visibility review found no semantic drift: public/private tag scope selection is preserved, Admin retains base reader plus back-office capabilities, planned tenant role grants remain unchanged, admin article access still uses the existing capability/context path, and AI ledger/cache helpers continue to avoid prompt/content persistence while preserving budget fallback behavior.

## Validation

- `git --no-pager diff --check` — PASS (exit 0)
- `npm run typecheck -- --pretty false` — PASS (exit 0)
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/import-boundary.test.ts tests/scripts-operational.test.ts tests/account-export.test.ts tests/scraper-providers-discovery.test.ts tests/feed.test.ts tests/admin-ai-ops.test.ts tests/ai-facade.test.ts tests/ai-article-cache.test.ts tests/ai-chunking.test.ts tests/offline-registry.test.ts tests/tts-prose-highlight.test.ts tests/tts-prose-highlight-hook.test.ts` — PASS, 121 tests passed, 0 failed

## Recommended next batch focus

Proceed with the next refactor batch, prioritizing similarly focused extraction/type-safety changes in remaining scraper/script/feed/runtime areas and keeping nearest focused tests paired with each behavior-preserving edit.

# Mouse scraper/import/pipeline refactor pass 8

Timestamp: 2026-07-03T02:44:45.299+00:00
Author: Mouse
Requested by: Ralph Agent

## Decisions

- Confirmed all target files were clean before editing and limited changes to the five allowed target files.
- Kept scraper fetch behavior unchanged while extracting host span sanitization, request header construction, redirect detection, and HTTP error creation helpers in `src/lib/scraper/fetch.ts`.
- Kept processing registry semantics unchanged while extracting shared missing-count predicates and difficulty/translation clear helpers in `src/lib/processing/registry.ts`.
- Kept job lifecycle transitions unchanged while extracting shared timestamp and lock-release helpers in `src/lib/jobs/lifecycle.ts`.
- Kept cache key/tag/invalidation semantics unchanged while extracting tenant cache-name and oldest-entry eviction helpers in `src/lib/cache.ts`.
- Kept admin query filtering/pagination semantics unchanged while extracting normalized option and Prisma where builders in `src/lib/jobs/admin-queries.ts`.

## Validation

- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-fetch.test.ts tests/tenant-cache.test.ts tests/listing-cache.test.ts tests/jobs.test.ts tests/admin-jobs.test.ts tests/processing-pipeline.test.ts` — passed, 65/65 tests.
- `npx eslint src/lib/scraper/fetch.ts src/lib/processing/registry.ts src/lib/jobs/lifecycle.ts src/lib/cache.ts src/lib/jobs/admin-queries.ts` — passed.
- `git --no-pager diff --check -- src/lib/scraper/fetch.ts src/lib/processing/registry.ts src/lib/jobs/lifecycle.ts src/lib/cache.ts src/lib/jobs/admin-queries.ts` — passed.

# Switch test refactor 8

- Refactored only the requested untouched test files and did not edit implementation files or pre-existing modified files outside the target list.
- Kept behavior/assertion intent intact by extracting local helpers for repeated fixtures, provider cleanup setup, route request dispatch, replay removal checks, and Today privacy metadata gates.
- Validation passed with: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-cleanup.test.ts tests/annotations.test.ts tests/classroom-routes.test.ts tests/today-offline.test.ts tests/today-rollout-privacy.test.ts`.

# Trinity UI refactor pass 8

- Target files were clean before editing; existing non-target worktree changes were left untouched.
- Refactored five allowed UI files only: admin jobs, flashcard review, level timeline, profile settings, and admin tag actions.
- Kept behavior, routes, API calls, form fields, and keyboard/focus semantics unchanged while extracting repeated helpers and replacing local inline layout styles with existing token utility classes where safe.
- Validation passed:
  - `npx eslint src/app/admin/jobs/page.tsx src/components/FlashcardReview.tsx src/components/LevelTimeline.tsx src/app/'(app)'/settings/ProfileSettingsForm.tsx src/components/AdminTagActions.tsx`
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/level-timeline.test.ts tests/keyboard-shortcut-registry.test.ts tests/profile.test.ts tests/profile-route.test.ts tests/admin-tag-commands.test.ts tests/tags.test.ts tests/admin-jobs.test.ts tests/admin-jobs-routes.test.ts`
  - `git --no-pager diff --check -- src/app/admin/jobs/page.tsx src/components/FlashcardReview.tsx src/components/LevelTimeline.tsx src/app/'(app)'/settings/ProfileSettingsForm.tsx src/components/AdminTagActions.tsx`

# Tank learning/placement/backend refactor pass

- Refactored only the permitted untouched target files:
  - `src/lib/learning/skill-mastery.ts`
  - `src/lib/learning/word-mastery.ts`
  - `src/lib/placement.ts`
  - `src/lib/moderation/reports.ts`
  - `src/lib/security/client-ip.ts`
- Preserved public exports and behavior while extracting small helpers for evidence parsing/EMA confidence, word mastery score data assembly, placement threshold/fallback handling, moderation report validation/mapping, and client-IP normalization/resolution.
- Did not change learning or placement scoring thresholds, moderation/report statuses/dedup semantics, trusted proxy/client IP precedence, or redaction/logging behavior.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/skill-mastery.test.ts tests/word-mastery.test.ts tests/placement.test.ts tests/content-reports.test.ts tests/client-ip.test.ts` (83 tests passed).
- Whitespace check passed: `git --no-pager diff --check -- src/lib/learning/skill-mastery.ts src/lib/learning/word-mastery.ts src/lib/placement.ts src/lib/moderation/reports.ts src/lib/security/client-ip.ts` (exit 0, no output).

# Morpheus review: refactor batch eight

Verdict: APPROVE

No changed artifact needs revision. The batch appears behavior-preserving across learning/placement scoring, moderation, client IP resolution, job/cache/registry behavior, scraper fetch behavior, UI refactors, and test helper extraction.

Validation:
- Known pre-review baseline from requester: `git --no-pager diff --check` passed.
- Known pre-review baseline from requester: `npm run typecheck -- --pretty false` passed.
- Ran focused tests: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/skill-mastery.test.ts tests/word-mastery.test.ts tests/placement.test.ts tests/content-reports.test.ts tests/client-ip.test.ts tests/admin-jobs.test.ts tests/jobs.test.ts tests/tenant-cache.test.ts tests/scraper-fetch.test.ts tests/scraper-fetch-browser-core.test.ts tests/processing-pipeline.test.ts tests/level-timeline.test.ts tests/keyboard-shortcut-registry.test.ts tests/scraper-cleanup.test.ts tests/annotations.test.ts tests/classroom-routes.test.ts tests/today-offline.test.ts tests/today-rollout-privacy.test.ts` — exit code 0.
- Quiet rerun summary: 257 tests, 4 suites, 257 pass, 0 fail, duration 7237.180539ms.

Recommended next batch focus: continue with small, typed helper extraction in remaining UI/business modules; prioritize files with duplicated action/error handling and large pure calculation blocks, while preserving provider fallback and privacy redaction invariants.

# Switch test refactor 9

- Date: 2026-07-03T00:53:11.812+00:00
- Author: Switch
- Scope: behavior-preserving refactor pass on untouched target test files only.

## Decisions

- Refactored `tests/scraper-knowable.test.ts` by extracting `withReadabilityDisabled` for repeated `SCRAPER_READABILITY` setup/restoration and `assertNoPlaceholderText` for repeated placeholder assertions. Kept fixtures, assertions, and extraction semantics unchanged.
- Refactored `tests/content-reports.test.ts` by extracting a local `makeReport` builder for repeated mocked content report rows. Kept status/reason overrides and assertions unchanged.
- Refactored `tests/coach-memory.test.ts` by extracting local `makeCoachMemory`, `seedCoachMemory`, and `seedSkillMastery` helpers for repeated in-memory row setup. Kept mocked persistence behavior, privacy assertions, stale weighting, and side-effect semantics unchanged.
- Left `tests/auth-security-backend.test.ts` and `tests/engagement-data-read-models.test.ts` untouched because their existing local setup was already compact enough for a surgical pass without introducing broader churn.

## Validation

- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-knowable.test.ts tests/content-reports.test.ts tests/coach-memory.test.ts` — passed, 47/47 tests.
- `npx eslint tests/scraper-knowable.test.ts tests/content-reports.test.ts tests/coach-memory.test.ts` — passed.

# Trinity UI refactor 9

- Refactored only the approved untouched target files: `ActivityHeatmap`, `ReminderPreferencesForm`, `HighlightEditPopover`, `ReaderAudioProvider`, and `CategoryBrowser`.
- Preserved routes, API endpoints, form fields, focus/keyboard behavior, reader highlight behavior, and visual values.
- Kept changes surgical: extracted repeated label/payload/query helpers, named repeated constants, memoized reader audio context value, and reused existing UI primitives.
- Validation: `git --no-pager diff --check -- src/components/ActivityHeatmap.tsx src/components/ReminderPreferencesForm.tsx src/components/reader/wordLookup/HighlightEditPopover.tsx src/components/ReaderAudioProvider.tsx src/components/CategoryBrowser.tsx && npx eslint --max-warnings=0 src/components/ActivityHeatmap.tsx src/components/ReminderPreferencesForm.tsx src/components/reader/wordLookup/HighlightEditPopover.tsx src/components/ReaderAudioProvider.tsx src/components/CategoryBrowser.tsx` passed.
- Additional check: `npm run typecheck -- --pretty false` failed on pre-existing unrelated duplicate `currentRank` declarations in `src/lib/leveling/engine.ts`; IDE diagnostics were unavailable.

# Mouse pipeline refactor 9

Date: 2026-07-03T00:53:11.812+00:00
Author: Mouse
Requested by: Ralph Agent

## Decisions

- Kept edits limited to the five allowed, previously untouched target files.
- Preserved behavior by extracting only local helpers around existing logic: Today selection/analytics orchestration, leveling rounding/evidence helpers, goal-path delta component helpers, scraper dedupe/rule matching helpers, and AI tutor fallback/context/message builders.
- Did not change generator/repository semantics, leveling thresholds, content/scraper provider rules, persisted tutor messages, or fallback behavior.
- Validation passed with targeted ESLint, targeted node tests, and target diff whitespace check.

# Tank observability/tenant/reminder refactor 9

Date: 2026-07-03T00:53:11.812+00:00
Author: Tank

## Decision

Performed behavior-preserving backend refactors only in the requested untouched target files:

- `src/lib/observability/slo-catalog.ts`: extracted shared ratio/no-data handling, measurement dispatch, SLI status/count helpers.
- `src/lib/observability/errors.ts`: extracted error coercion and best-effort metric/sink/alert emission helpers while preserving swallowed reporting failures.
- `src/lib/analytics/tenant.ts`: extracted roster completion indexing and per-assignment/per-student count helpers; retained aggregate-only org-admin redaction behavior.
- `src/lib/reminder-preferences.ts`: extracted timezone parsing and row-to-preference mapping; retained quiet-hour/preferred-hour validation semantics.
- `src/lib/account-lifecycle/member-detail.ts`: extracted member profile/progress/activity/import/audit mappers and named recent-window milliseconds constant; retained selected fields and privacy behavior.

No public exports, SLO thresholds, error redaction/logging fields, tenant analytics visibility, reminder preference semantics, or admin member detail selected data were intentionally changed. No commit was created.

## Validation

- `npx eslint src/lib/observability/slo-catalog.ts src/lib/observability/errors.ts src/lib/analytics/tenant.ts src/lib/reminder-preferences.ts src/lib/account-lifecycle/member-detail.ts` — passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/slo.test.ts tests/error-reporting.test.ts tests/tenant-analytics.test.ts tests/reminder-preferences.test.ts tests/admin-member-detail.test.ts` — passed, 49/49 tests.
- `npx tsc --noEmit --pretty false --incremental false` — passed.

# Morpheus Refactor Review — Batch 9

Verdict: APPROVE

Reviewed files:
- src/lib/observability/slo-catalog.ts
- src/lib/observability/errors.ts
- src/lib/analytics/tenant.ts
- src/lib/reminder-preferences.ts
- src/lib/account-lifecycle/member-detail.ts
- src/components/ActivityHeatmap.tsx
- src/components/ReminderPreferencesForm.tsx
- src/components/reader/wordLookup/HighlightEditPopover.tsx
- src/components/ReaderAudioProvider.tsx
- src/components/CategoryBrowser.tsx
- src/lib/engagement/today-session/generator.ts
- src/lib/leveling/engine.ts
- src/lib/learning/goal-path.ts
- src/lib/scraper/providers/shared.ts
- src/lib/ai/tutor.ts
- tests/scraper-knowable.test.ts
- tests/content-reports.test.ts
- tests/coach-memory.test.ts

Findings: None requiring revision. The refactors appear behavior-preserving across observability/error capture, tenant analytics aggregation/redaction, reminder preference validation/accessors, member detail mapping, route/query construction, focus/ref handling, Today plan generation analytics, leveling/goal-path math, scraper shared helpers, AI tutor fallback/persistence behavior, and test helper extraction.

Validation:
- Known baseline provided immediately before review: `git --no-pager diff --check` passed; `npm run typecheck -- --pretty false` passed.
- Ran: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/slo.test.ts tests/error-reporting.test.ts tests/tenant-analytics.test.ts tests/reminder-preferences.test.ts tests/today-session-generator.test.ts tests/leveling.test.ts tests/leveling-adaptive.test.ts tests/goal-path.test.ts tests/scraper-rss-extractor.test.ts tests/tutor.test.ts tests/ai-input-safety.test.ts tests/scraper-knowable.test.ts tests/content-reports.test.ts tests/coach-memory.test.ts`
  - Result: pass — 190 tests passed, 0 failed, duration 10557 ms.
- Independent code-review subagent: no findings.

Recommended next batch focus: review the remaining larger operational/runtime refactors in scripts, processing/scraper pipeline files, admin/import UI surfaces, and shared API/cache/offline modules, prioritizing behavior that can affect production jobs or cross-route contracts.

# Switch test refactor pass 10

Timestamp: 2026-07-03T00:53:11.812+00:00
Requested by: Ralph Agent

## Decisions

- Edited only the allowed target tests that were clean at task start: `tests/highlights.test.ts`, `tests/scraper.test.ts`, `tests/scraper-index.test.ts`, `tests/difficulty.test.ts`, and `tests/shared-validation-pure.test.ts`.
- Kept changes behavior-preserving: extracted local request/import/builders, env/prisma restoration helpers, article factory, and storage mock builders while preserving existing assertions and fixtures.
- Did not touch source files, non-target tests, git branches, commits, resets, or notes.

## Validation

Command:

```sh
NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/highlights.test.ts tests/scraper.test.ts tests/scraper-index.test.ts tests/difficulty.test.ts tests/shared-validation-pure.test.ts
```

Result: passed — 101 tests, 0 failures, duration 23322.927498 ms.

# Tank backend refactor 10

2026-07-03 — Tank performed a behavior-preserving refactor pass limited to the requested untouched backend target files.

Files changed:
- `src/lib/security/events.ts`
- `src/lib/article-library/review.ts`
- `src/lib/article-library/listings.ts`
- `src/lib/recommendations/picks.ts`
- `src/lib/offline-conflict.ts`

Decisions:
- Kept all public exports and business/security semantics intact; only extracted private helpers and removed local duplication.
- Preserved security event redaction, logging fields, metric recording, ring-buffer behavior, spike escalation, and alert error construction from `recordSecurityEvent` so alert fingerprinting remains anchored there.
- Preserved article review/listing semantics, personal import pagination, recommendation candidate visibility revalidation, and offline conflict/no-silent-loss behavior.
- Did not touch other modified worktree files and did not commit.

Validation:
- `npx eslint src/lib/security/events.ts src/lib/article-library/review.ts src/lib/article-library/listings.ts src/lib/recommendations/picks.ts src/lib/offline-conflict.ts && NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/security-events.test.ts tests/offline-conflict.test.ts tests/article-review-workflow.test.ts tests/content-review.test.ts tests/article-library-read-models.test.ts tests/recommendations.test.ts tests/recommendations-candidate-visibility.test.ts`
- Result: pass — 73 tests passed, 0 failed; eslint completed without errors.

# Mouse scraper/pipeline refactor pass

Timestamp: 2026-07-03T00:53:11.812+00:00
Author: Mouse
Requested by: Ralph Agent

## Decision
Performed behavior-preserving, surgical refactors only in target files that were clean at task start.

## Files changed
- `scripts/prune-local-dictionary.ts`: introduced explicit removal/result types and extracted inflection removal selection from the dictionary pruning loop.
- `src/lib/scraper/discovery.ts`: extracted URL canonicalization and provider article URL validation shared by seed-link and extractor discovery paths.
- `src/lib/runtime-config/ai.ts`: centralized integer and non-negative float env parsing helpers while preserving existing fallbacks.
- `src/lib/http/provider-client.ts`: extracted option resolution, host derivation, and retry-delay calculation helpers from `providerFetch`.

## Files left untouched
- `src/lib/scraper/quality-classifier-corpus.ts`: left unchanged because it is marked generated and hand-editing harvested arrays would be inappropriate for a behavior-preserving refactor.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/http-provider-client.test.ts tests/scraper-extractor.test.ts tests/scraper-pagination.test.ts tests/discovery-default-fetch.test.ts tests/sources-feed-discovery.test.ts` — passed, 37/37 tests.
- `npm run typecheck -- --pretty false` — passed.
- `npm run dict:prune -- --dry-run` — passed; reported no removals and dry run did not modify dictionary files.
- `npx eslint scripts/prune-local-dictionary.ts src/lib/scraper/discovery.ts src/lib/runtime-config/ai.ts src/lib/http/provider-client.ts` — passed.
- `git --no-pager diff --check -- scripts/prune-local-dictionary.ts src/lib/scraper/discovery.ts src/lib/runtime-config/ai.ts src/lib/http/provider-client.ts` — passed.

# Trinity UI refactor 10

- Kept refactor scope to the five allowed target files; target files were clean before editing.
- Preserved UI behavior, routes, API calls, form fields, keyboard/focus semantics, reader selection/highlight behavior, and design-token conventions.
- Refactors applied: extracted small helpers/constants for onboarding placement state, reader mini-player controls, admin article review parsing/toggles, admin member support section rendering, and push reminder setup/error paths.
- Validation passed:
  - `npx eslint -- src/app/onboarding/useOnboardingWizard.ts src/components/ReaderMiniPlayer.tsx src/components/AdminArticleReview.tsx 'src/app/admin/members/[id]/page.tsx' src/components/PushReminderToggle.tsx`
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/admin-member-detail.test.ts tests/article-review-workflow.test.ts tests/push-routes.test.ts tests/placement-scorer.test.ts` (27/27 passed)
  - `npm run typecheck -- --pretty false`

# APPROVE — Refactor batch ten

Requested by: Ralph Agent
Reviewer: Morpheus
Timestamp: 2026-07-03T00:53:11.812+00:00

## Findings

No blocking findings. The batch appears behavior-preserving across the reviewed domains: security event logging/escalation, article review/listing policies, recommendation candidate visibility, offline conflict rules, UI route/API/focus semantics, scraper discovery/provider runtime behavior, and the changed test helpers.

## Validation

Known baseline immediately before review:
- `git --no-pager diff --check` — PASS
- `npm run typecheck -- --pretty false` — PASS

Reviewer validation run:
- `npx eslint src/lib/security/events.ts src/lib/article-library/review.ts src/lib/article-library/listings.ts src/lib/recommendations/picks.ts src/lib/offline-conflict.ts src/app/onboarding/useOnboardingWizard.ts src/components/ReaderMiniPlayer.tsx src/components/AdminArticleReview.tsx 'src/app/admin/members/[id]/page.tsx' src/components/PushReminderToggle.tsx scripts/prune-local-dictionary.ts src/lib/scraper/discovery.ts src/lib/runtime-config/ai.ts src/lib/http/provider-client.ts tests/highlights.test.ts tests/scraper.test.ts tests/scraper-index.test.ts tests/difficulty.test.ts tests/shared-validation-pure.test.ts` — PASS
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/security-events.test.ts tests/auth-security-backend.test.ts tests/redaction.test.ts tests/article-library-read-models.test.ts tests/content-review.test.ts tests/article-review-workflow.test.ts tests/recommendations.test.ts tests/recommendations-candidate-visibility.test.ts tests/offline-conflict.test.ts tests/offline-runtime.test.ts tests/http-provider-client.test.ts tests/server-read-models-runtime.test.ts tests/scraper.test.ts tests/scraper-index.test.ts tests/scraper-providers-discovery.test.ts tests/highlights.test.ts tests/difficulty.test.ts tests/shared-validation-pure.test.ts` — PASS

## Recommended next batch focus

Continue with cross-boundary refactors that have explicit focused tests nearby, prioritizing UI components with API side effects and scraper/provider pipeline seams.

# Switch test refactor 11

- Refactored only the requested untouched target tests; no source files were edited.
- Extracted local test helpers for clock patching, fetch response/setup, diagnostic-code assertions, seeded engagement progress rows, and processing transaction doubles.
- Preserved existing assertions, fixtures, mocks, and edge-case semantics; changes are behavior-preserving duplication/readability cleanup.
- Validation command: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/auth-security-backend.test.ts tests/engagement-data-read-models.test.ts tests/ai-lexical-tutor.test.ts tests/processing-pipeline.test.ts tests/config-runtime-env.test.ts`
- Validation result: 27 tests passed, 0 failed.

# Tank backend refactor 11

- Refactored only the allowed untouched target files: seed orchestration, Today analytics emitters, progress helpers, processing-state helpers, and metrics registry helpers.
- Kept public exports and behavior intact; changes are private helper extraction/deduplication only.
- Preserved seed crawl-health counts, Today metadata-only event payloads, progress forward-only/sticky completion behavior, processing best-effort logging/state transitions, and metrics label normalization/snapshot sorting.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/progress.test.ts tests/today-analytics.test.ts tests/processing-state.test.ts tests/processing-state-read.test.ts tests/metrics-registry.test.ts tests/seed-crawl-health.test.ts` (44/44 pass) and `npx eslint src/lib/seed.ts src/lib/engagement/today-session/analytics.ts src/lib/engagement/progress.ts src/lib/processing/state.ts src/lib/metrics/registry.ts` (pass).

# Mouse content/scraper refactor pass

Date: 2026-07-03T03:24:26.404+00:00
Requested by: Ralph Agent

## Decisions

- Edited only the allowed, initially untouched target files.
- Kept scraper robots semantics intact by extracting cache-key/URL/rule helpers without changing fail-open behavior, path matching, or cache scope.
- Kept content pipeline output intact by moving reader-block walking and inline flushing into local helpers with the same DOM traversal order and normalization.
- Kept saved-word behavior intact by centralizing trim/lowercase helpers and preserving existing query shapes, including pagination and filter construction.
- Kept AI output validation behavior intact by extracting record detection and a shared title-case minor-word set while preserving rejection/dedup rules.
- Kept search semantics intact by centralizing repeated readable-article queries and candidate insertion while preserving query order, ranking inputs, annotation backfill, and Postgres fallback behavior.

## Validation

- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/robots.test.ts tests/content-pipeline.test.ts tests/ai-validation.test.ts tests/tags.test.ts tests/engagement-data-read-models.test.ts tests/search-sql-predicate.test.ts tests/server-read-models-runtime.test.ts` — passed (74 tests).
- `npx eslint src/lib/scraper/robots.ts src/lib/content-pipeline/index.ts src/lib/lexical/saved-words.ts src/lib/ai/output/validators.ts src/lib/search/fulltext.ts` — passed.
- `npm run typecheck -- --pretty false` — passed.

# Trinity UI refactor 11

Date: 2026-07-03T03:24:26.514+00:00
Author: Trinity (Frontend Dev)
Requested by: Ralph Agent

## Decision
Performed a behavior-preserving refactor pass only on the five approved, previously untouched target files.

## Scope
- `src/components/AdminBackfillForm.tsx`
- `src/components/reader/wordLookup/DictionaryPopover.tsx`
- `src/components/ui/SegmentedControl.tsx`
- `src/components/reader/useCurrentReadingBlock.ts`
- `src/app/admin/analytics/page.tsx`

## Rationale
Kept edits surgical and internal: extracted repeated constants/helpers, clarified typed local state, centralized export/link/heading/bucket formatting, and replaced inline margin styles with equivalent token utility classes. No routes, API endpoints, form fields, keyboard/focus behavior, reader selection/highlight behavior, or public contracts were intentionally changed.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/current-reading-block.test.ts tests/current-reading-block-hook.test.ts tests/ui-segmented-control-index.test.ts tests/ui-cn.test.ts` — passed (33 tests).
- `npx eslint src/components/AdminBackfillForm.tsx src/components/reader/wordLookup/DictionaryPopover.tsx src/components/ui/SegmentedControl.tsx src/components/reader/useCurrentReadingBlock.ts src/app/admin/analytics/page.tsx` — passed.
- `npm run typecheck -- --pretty false` — passed.

# Morpheus Review — Refactor Batch Eleven

Verdict: APPROVE

Findings: No revision-blocking issues found. The batch appears behavior-preserving across seed orchestration, engagement analytics/progress, processing state transitions, metrics, UI route/API/focus behavior, robots/content pipeline/search/saved words, AI output validation, and test-only refactors.

Validation:
- Known baseline from requester: `git --no-pager diff --check` passed.
- Known baseline from requester: `npm run typecheck -- --pretty false` passed.
- Ran: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/auth-security-backend.test.ts tests/engagement-data-read-models.test.ts tests/ai-lexical-tutor.test.ts tests/processing-pipeline.test.ts tests/config-runtime-env.test.ts`
  Result: PASS — 27 tests passed, 0 failed.

Recommended next batch focus: continue with similarly scoped behavior-preserving extractions; prioritize any remaining high-risk flows that still lack focused coverage before broader UI-only cleanup.

# Switch test refactor 12

- Refactored only the requested clean target tests; did not edit source files or non-target tests.
- Kept behavior/assertions intact while extracting local fixtures/helpers for repeated test setup, route requests, admin tag audit callbacks, visibility assertions, and AI quota env resets.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/misc-routes.test.ts tests/admin-tag-commands.test.ts tests/security-regressions-idor.test.ts tests/ai-budget.test.ts tests/quiz-mastery-routes.test.ts` — 77 passed, 0 failed.

# Tank backend refactor 12

- Refactored only clean target files: today session repository, reading speed helpers, review assets, validation helpers, and offline article store.
- Kept public exports and behavior unchanged; extracted private helpers for controlled-value fallback mapping, WPM aggregation, review-card conversion shaping, numeric coercion/clamping, and IndexedDB request/transaction handling.
- Preserved privacy boundaries: no article text/note/prompt metadata moved into analytics/session state; review asset payloads remain ids/counts/schedule only.
- Validation completed with targeted Node tests and targeted ESLint successfully on 2026-07-03.

# Trinity UI refactor 12

- Refactored only the five approved target files; target files were clean before edits, while unrelated worktree changes were left untouched.
- Kept behavior preserving: extracted local UI/render helpers, summary formatters, filter/group helpers, and shared bookmark segment classes without changing routes, API calls, form fields, focus semantics, or reader selection/highlight behavior.
- Validation passed: `npx eslint -- src/app/onboarding/OnboardingForm.tsx src/components/SentenceTranslatePopover.tsx 'src/app/(app)/teacher/classrooms/[id]/page.tsx' src/components/ReaderBookmarkCluster.tsx 'src/app/(app)/notes/page.tsx'`; `npm run typecheck -- --pretty false`.

# Mouse translation refactor 12

- Refactored only the permitted untouched files: `src/lib/scraper/admin-trigger.ts`, `scripts/lib/cli.ts`, `src/lib/speech/index.ts`, `src/lib/ai/runner.ts`, and `src/lib/runtime-config/env.ts`.
- Kept behavior-preserving extractions only: scraper provider/url loops, CLI exit/error helpers, speech cache/synthesis helpers, AI signal/retry helpers, and runtime env issue helpers.
- Validation passed: targeted ESLint, full `npm run typecheck -- --pretty false`, and focused node tests covering CLI, AI runner, runtime config, speech index, and admin scrape/fallback routes.

# Morpheus review: refactor batch 12

Verdict: APPROVE

Requested by: Ralph Agent
Reviewed at: 2026-07-03T03:49:00Z

## Findings

No blocking findings. The reviewed refactors are behavior-preserving across the specified repository, reading-speed, review-assets, validation, offline storage, UI route/API/focus, scraper admin trigger, CLI, speech index, AI runner, runtime env, and test files.

## Validation

Baseline reported before review:
- `git --no-pager diff --check` — passed
- `npm run typecheck -- --pretty false` — passed

Commands run during review:
- `git --no-pager diff --check -- <batch 12 files>` — passed
- `npx eslint -- <batch 12 files>` — passed
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/admin-tag-commands.test.ts tests/ai-budget.test.ts tests/misc-routes.test.ts tests/quiz-mastery-routes.test.ts tests/security-regressions-idor.test.ts tests/reading-speed.test.ts tests/fluency-trend.test.ts tests/review-assets.test.ts tests/today-session-repository.test.ts tests/offline-runtime.test.ts tests/speech-orchestration.test.ts tests/speech-index-access.test.ts tests/ai-runner.test.ts tests/config-runtime-env.test.ts tests/cli-utils.test.ts tests/admin-scrape-routes.test.ts tests/routes-api-fallbacks.test.ts tests/shared-validation-pure.test.ts` — passed: 246 tests, 23 suites, 0 failures.

## Recommended next batch focus

Continue with similarly scoped behavior-preserving extraction, prioritizing files with nearby focused tests and keeping provider fallback/privacy boundaries intact.

# Trinity reader controls refactor 13

- Refactored only the requested untouched target files; avoided the many pre-existing modified files elsewhere in the worktree.
- Kept behavior, routes, API calls, form fields, focus/keyboard semantics, and reader selection/highlight behavior unchanged.
- Changes were extraction/deduplication only: shared tutor endpoint/transient helpers, selection toolbar action-button class/ref/key handler, cloze submit/input helpers, ReaderTools ToolPanel wrapper, and ConfirmAction reset/focus helpers.
- Validation passed: `npx eslint src/components/tutor/useTutorConversation.ts src/components/reader/wordLookup/SelectionToolbar.tsx src/components/flashcard/ClozeCard.tsx src/components/ReaderTools.tsx src/components/ConfirmAction.tsx`; `npm run typecheck -- --pretty false`.

# Switch test refactor 13

- Refactored only the requested untouched test files; no source files were edited.
- Kept behavior/assertion intent intact by extracting local helpers/constants only:
  - `tests/import-route.test.ts`: shared import URL/text/scrape-result fixtures and expanded inline Prisma callbacks for readability.
  - `tests/today-analytics.test.ts`: shared expected event catalog and event/property access helpers.
  - `tests/account-support-commands.test.ts`: shared dynamic import helper for support-command module loading.
  - `tests/sources-feed-discovery.test.ts`: split reset logic into content-source/feed fixture helpers.
  - `tests/weak-word-reexposure.test.ts`: shared score-candidate loader and test user/article IDs.
- Validation passed with:
  `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/weak-word-reexposure.test.ts tests/sources-feed-discovery.test.ts tests/import-route.test.ts tests/today-analytics.test.ts tests/account-support-commands.test.ts`
- Result: 57 tests passed, 0 failed.

# Tank backend refactor pass 13

Author: Tank
Date: 2026-07-03T00:53:11.812+00:00

## Decision
Performed a behavior-preserving refactor on the untouched target backend/client-safe support files only:

- `src/lib/offline-sync.ts`
- `src/lib/learning/article-mastery.ts`
- `src/lib/storage-keys.ts`
- `src/lib/offline/mutation-store.ts`
- `src/lib/client-fetch.ts`

## Rationale
The target files were clean at start, so edits were limited to private helpers/constants that reduce duplication and clarify existing state machines/scoring/storage behavior. Public exports and semantics were preserved: offline queue ordering/retry/conflict handling, mutation dedupe and storage behavior, storage key values, JSON fetch init/error behavior, and article comprehension/mastery calculations remain unchanged.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/offline-sync.test.ts tests/offline-runtime.test.ts tests/article-mastery.test.ts tests/client-fetch.test.ts tests/storage-worker-runtime.test.ts tests/shared-validation-pure.test.ts` — passed, 60/60 tests.
- `npx eslint src/lib/offline-sync.ts src/lib/learning/article-mastery.ts src/lib/storage-keys.ts src/lib/offline/mutation-store.ts src/lib/client-fetch.ts` — passed.
- `git --no-pager diff --check -- src/lib/offline-sync.ts src/lib/learning/article-mastery.ts src/lib/storage-keys.ts src/lib/offline/mutation-store.ts src/lib/client-fetch.ts` — passed.

# Mouse config/runtime/parser refactor pass

Timestamp: 2026-07-03T00:53:11.812+00:00
Author: Mouse
Requested by: Ralph Agent

## Decision
Performed a behavior-preserving refactor pass only on clean target files. Left `src/lib/scraper/quality-classifier-corpus.ts` untouched because it is generated/harvested corpus data and hand-editing it risks altering classifier training behavior.

## Files changed
- `src/lib/keyboard-shortcuts.ts`
  - Centralized runtime owner strings and reference-only shortcut construction.
  - Hoisted Mac platform regex.
  - Preserved shortcut group data, disabled-in-input metadata, and keyboard semantics.
- `src/lib/reader-prefs.ts`
  - Extracted reader default constants and object-record parsing guard.
  - Hoisted font-scale labels.
  - Preserved localStorage parsing, invalid-value fallbacks, app-theme default mode, and bootstrap script behavior.
- `src/lib/analytics/queries/overview.ts`
  - Extracted pure helpers for user intersection, ratios, event totals, distinct totals, and funnel construction.
  - Preserved funnel ordering, conversion math, feature usage sorting, and totals.
- `src/lib/ai/ledger.ts`
  - Extracted token normalization, total-token inference, and ledger data construction.
  - Preserved best-effort writes, cache-hit semantics, cost estimation, request-context fallbacks, and metadata-only redaction behavior.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/reader-prefs.test.ts tests/keyboard-shortcut-registry.test.ts tests/analytics-queries.test.ts tests/ai-ledger.test.ts tests/ai-ledger-cache.test.ts tests/scraper-quality-classifier.test.ts`
  - Result: pass, 79 tests.
- `npx eslint src/lib/keyboard-shortcuts.ts src/lib/reader-prefs.ts src/lib/analytics/queries/overview.ts src/lib/ai/ledger.ts`
  - Result: pass.

# Morpheus refactor review batch 13

Verdict: APPROVE

Findings: No behavior-changing, type-safety, import, offline sync/mutation, storage key, client fetch, article mastery, reader controls, keyboard shortcut, reader prefs, analytics, AI ledger, or test-refactor issues found in the reviewed batch files.

Validation:
- `npx eslint src/lib/offline-sync.ts src/lib/learning/article-mastery.ts src/lib/storage-keys.ts src/lib/offline/mutation-store.ts src/lib/client-fetch.ts src/components/tutor/useTutorConversation.ts src/components/reader/wordLookup/SelectionToolbar.tsx src/components/flashcard/ClozeCard.tsx src/components/ReaderTools.tsx src/components/ConfirmAction.tsx src/lib/keyboard-shortcuts.ts src/lib/reader-prefs.ts src/lib/analytics/queries/overview.ts src/lib/ai/ledger.ts tests/weak-word-reexposure.test.ts tests/sources-feed-discovery.test.ts tests/import-route.test.ts tests/today-analytics.test.ts tests/account-support-commands.test.ts` — passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/offline-sync.test.ts tests/offline-runtime.test.ts tests/client-fetch.test.ts tests/article-mastery.test.ts tests/reader-prefs.test.ts tests/keyboard-shortcut-registry.test.ts tests/analytics-queries.test.ts tests/ai-ledger.test.ts tests/ai-ledger-cache.test.ts tests/weak-word-reexposure.test.ts tests/sources-feed-discovery.test.ts tests/import-route.test.ts tests/today-analytics.test.ts tests/account-support-commands.test.ts` — passed, 171 tests.

Recommended next batch focus: continue with provider/runtime boundaries and any remaining refactors around scraper/feed/processing modules, keeping privacy redaction and optional-provider fallback semantics central.

# switch-test-refactor-14

- Refactored only the requested untouched target test files; no source files edited.
- Extracted local helpers for route request construction, study-plan state reset/profile setup, article search result ID assertions, speech fixture builders, and reader prose/mark setup.
- Preserved existing assertions, mocked providers, fixture values, and edge-case coverage intent.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/reader-highlight-marks.test.ts tests/articles-search.test.ts tests/pronunciation-routes.test.ts tests/study-plan.test.ts tests/speech-orchestration.test.ts` — 55 passed, 0 failed.

# Mouse helpers refactor 14

Author: Mouse
Timestamp: 2026-07-03T00:53:11.812+00:00
Requested by: Ralph Agent

## Decisions

- Left `src/lib/scraper/quality-classifier-corpus.ts` untouched because it is marked GENERATED and contains harvested corpus arrays. Hand-editing it would be risky and should be done through `scripts/build-quality-corpus.ts` plus classifier retraining.
- Refactored `src/lib/dictation.ts` by extracting tokenization, edit-distance table creation, backtracking predicates, diff-token construction, and accuracy calculation. Public parser/grading semantics and exported APIs are unchanged.
- Refactored `src/lib/focus-trap.ts` by extracting initial-focus, Escape handling, and Tab cycling helpers. Focus trap behavior and options are unchanged.
- Refactored `src/lib/discovery-ranking.ts` by naming score tables and age scoring helpers. Discovery ranking scores and freshness thresholds are unchanged.
- Refactored `src/lib/runtime-config/scraper.ts` by centralizing env integer reads and default-on boolean toggles. Runtime scraper config behavior is unchanged.

## Validation

- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/discovery-ranking.test.ts tests/dictation.test.ts tests/focus-trap.test.ts tests/scraper-fetch-strategies.test.ts` → passed (109 tests).
- `npx eslint src/lib/dictation.ts src/lib/discovery-ranking.ts src/lib/focus-trap.ts src/lib/runtime-config/scraper.ts` → passed.
- `git --no-pager diff --check -- src/lib/dictation.ts src/lib/discovery-ranking.ts src/lib/focus-trap.ts src/lib/runtime-config/scraper.ts src/lib/scraper/quality-classifier-corpus.ts` → passed.

# Tank Backend Refactor 14

- Refactored only the five approved backend target files; they were clean before editing.
- Kept public exports and behavior intact by extracting shared private constants/helpers only: quiz attempt select/trend mapping, study-plan reader href selection, learner analytics constants/progress counting, pending job create data, and member existence select.
- Preserved quiz mastery/study-plan shapes, learner analytics semantics, job enqueue/dedupe behavior, support command audit/redaction behavior, and did not commit.

Validation:
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/quiz-mastery-lib.test.ts tests/study-plan.test.ts tests/jobs-org-analytics-backend.test.ts tests/account-support-commands.test.ts` — pass (46 tests).
- `npm run typecheck -- --pretty false` — pass.
- `npx eslint src/lib/learning/quiz-mastery.ts src/lib/learning/study-plan-types.ts src/lib/analytics/learner.ts src/lib/jobs/enqueue.ts src/lib/account-lifecycle/support-commands.ts` — pass.
- `git --no-pager diff --check -- <target files>` — pass.

# Trinity reader shell refactor 14

- Refactored only the requested untouched target files; did not commit.
- Kept behavior, provider order, routes, API endpoints/payloads, form/focus semantics, and reader selection/highlight behavior unchanged.
- Extracted small helpers for reader tool visited-set updates, review-card loading, study-page derived labels/word mapping, highlight orphan set updates, and reader shell composition.
- Validation passed: `npx eslint -- src/components/ReaderToolsProvider.tsx src/components/flashcard/useReviewSession.ts 'src/app/(app)/study/page.tsx' src/components/ReaderHighlightsProvider.tsx 'src/app/(app)/reader/[id]/ReaderShell.tsx'`; `npm run typecheck`; `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/review-session-reducer.test.ts tests/highlights-reducer.test.ts tests/gamification.test.ts`.
- Note: an attempted `npm run test -- ...` invoked the repository glob from package.json and ran beyond the intended target; it completed with exit 1 before the corrected targeted node:test command passed.

APPROVE

Findings:
- No behavior-preserving, type-safety, import, semantic drift, or test-refactor correctness issues found in batch fourteen.
- Reviewed quiz mastery, study-plan item mapping, learner analytics, job enqueue dedupe/reset data, account support commands, reader providers/shell behavior, focus trap, discovery ranking, scraper config, dictation grading, and focused tests.

Validation:
- Known pre-review baseline: `git --no-pager diff --check` passed; `npm run typecheck -- --pretty false` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/reader-highlight-marks.test.ts tests/articles-search.test.ts tests/pronunciation-routes.test.ts tests/study-plan.test.ts tests/speech-orchestration.test.ts` — pass: 55 tests, 0 fail.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/quiz-mastery-lib.test.ts tests/jobs.test.ts tests/jobs-org-analytics-backend.test.ts tests/account-support-commands.test.ts tests/discovery-ranking.test.ts tests/scraper-limits.test.ts tests/scraper-fetch-strategies.test.ts tests/dictation.test.ts tests/focus-trap.test.ts` — pass: 166 tests, 0 fail.

Recommended next batch focus:
- Continue with similarly small extraction/memoization refactors, prioritizing modules with direct focused coverage and avoiding broader UI/route semantic changes.

# Switch test refactor 15

- Refactored only the requested untouched target tests: tags, security sanitization, speech repository, bookmarks, and routes.
- Kept behavior and assertions equivalent by extracting local fixtures/helpers for repeated public tags/article rows, sanitizer regex/content access, speech parser rejection cases, bookmark list/status helpers, and route state/request-id checks.
- Validation passed: `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/tags.test.ts tests/security-regressions-sanitization.test.ts tests/speech-repository.test.ts tests/bookmarks.test.ts tests/routes.test.ts` (68 passed, 0 failed).

# Mouse provider/runtime/scraper refactor pass

Date: 2026-07-03T04:11:40Z
Author: Mouse
Requested by: Ralph Agent

## Decision
Performed behavior-preserving extraction/organization refactors only in the five allowed untouched target files:

- `src/lib/ai/azure-provider.ts`: extracted Azure chat URL/body construction while preserving max_completion_tokens, temperature omission for Azure, no retries, and normalized error behavior.
- `src/lib/speech/practice.ts`: extracted sentence-boundary, word-count, and practisable-sentence helpers while preserving abbreviation/decimal guards and TTS alignment behavior.
- `src/lib/security/rate-limit/index.ts`: replaced scope switch with resolver map and extracted shared-store check, preserving shared-store-first behavior, ApiError propagation, memory fallback, and redacted warning metadata.
- `src/app/api/placement/route.ts`: extracted placement count validation, recommended-level selection, and persistence payload creation while preserving route contracts, privacy properties, upsert behavior, and analytics metadata.
- `src/lib/scraper/providers/theconversation.ts`: extracted sitemap/category constants and archive-sitemap loading helpers while preserving English-edition filtering, newest-first ordering, graceful sitemap failures, and category rules.

No files outside the explicit target list were edited by Mouse. No commits or branch operations were performed.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/ai-lexical-tutor.test.ts tests/dictation.test.ts tests/rate-limit.test.ts tests/placement-route.test.ts tests/providers.test.ts tests/scraper-rss-extractor.test.ts tests/scraper-providers-discovery.test.ts` → passed, 124/124 tests.
- `npx eslint src/lib/ai/azure-provider.ts src/lib/speech/practice.ts src/lib/security/rate-limit/index.ts src/app/api/placement/route.ts src/lib/scraper/providers/theconversation.ts` → passed.
- `git --no-pager diff --check -- <target files>` → passed.
- `npm run typecheck` → failed on pre-existing/unrelated diagnostics in `src/lib/annotations/commands.ts` and `tests/speech-repository.test.ts`; no target-file diagnostics were reported in tsc output.
- IDE diagnostics were attempted for target files, but the IDE MCP server was unavailable.

# Trinity display/admin UI refactor 15

- Refactored only the five allowed target files; all were unmodified at task start.
- Kept behavior, routes, form fields, API calls, focus/selection semantics, and design-system primitives intact.
- Extracted pure helpers/components for admin members/reports table rows and actions.
- Extracted reducer/timer/dictation helpers to reduce duplicated reset/transition/cleanup logic.
- Validation: targeted ESLint passed; focused node tests passed (56/56). Full `npm run typecheck` was attempted and failed on pre-existing unrelated errors in `src/lib/annotations/commands.ts` and `tests/speech-repository.test.ts`.

# Tank backend refactor 15

Author: Tank
Date: 2026-07-03

## Decision
Performed a behavior-preserving refactor pass limited to the approved target files.

## Scope
- `src/lib/engagement/today-session/types.ts`: clarified controlled-value helper boundaries without changing value sets, validators, assertions, or `toIdArray` semantics.
- `src/lib/annotations/commands.ts`: extracted private command result/data aliases and highlight color/conflict helpers while preserving create/update/delete behavior, ownership checks, offline note conflict merging, and error payloads.
- `src/lib/reader/schemas.ts`: replaced repeated validation bounds with private named constants; request schemas and inferred public types remain structurally unchanged.
- `src/lib/reader/page-loader.ts`: extracted private keep-reading fallback, bookmark, and difficulty-vote helpers; authorization, analytics metadata, related fallback behavior, sanitization, and plain-text loading are unchanged.
- `src/lib/display-format.ts`: extracted private date coercion/validation and locale constant; formatting outputs remain unchanged.

## Validation
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/display-format.test.ts tests/today-session-types.test.ts tests/annotations.test.ts tests/highlights.test.ts` — passed: 101 tests.
- `npx eslint src/lib/engagement/today-session/types.ts src/lib/annotations/commands.ts src/lib/reader/schemas.ts src/lib/reader/page-loader.ts src/lib/display-format.ts` — passed.
- `npm run typecheck` — target files typecheck clean after fixing local annotation helper type; command still fails on pre-existing unrelated `tests/speech-repository.test.ts` callback parameter variance errors.

## Notes
No public exports were added, removed, or renamed. No commits were created.

# Morpheus Review — Refactor Batch 15

Verdict: APPROVE

Reviewed files:
- src/lib/engagement/today-session/types.ts
- src/lib/annotations/commands.ts
- src/lib/reader/schemas.ts
- src/lib/reader/page-loader.ts
- src/lib/display-format.ts
- src/components/reader/wordLookup/useSurfaceController.ts
- src/app/admin/members/page.tsx
- src/components/reader/study/useDictationPanel.ts
- src/components/reader/ReaderTimeTracker.tsx
- src/app/admin/reports/page.tsx
- src/lib/ai/azure-provider.ts
- src/lib/speech/practice.ts
- src/lib/security/rate-limit/index.ts
- src/app/api/placement/route.ts
- src/lib/scraper/providers/theconversation.ts
- tests/tags.test.ts
- tests/security-regressions-sanitization.test.ts
- tests/speech-repository.test.ts
- tests/bookmarks.test.ts
- tests/routes.test.ts

Findings: No blocking issues. Changes are behavior-preserving extractions/constant hoists/type helpers. Switch's focused generic helper fix in tests/speech-repository.test.ts is type-safe and preserves the rejection assertions. Today-session controlled-value helpers preserve allowed-value/set semantics. Annotation command helpers preserve color validation, conflict detection, and delete result shape. Reader schema constants preserve limits; page-loader keep-reading fallback/bookmark/vote semantics are unchanged. UI controller/display/dictation/time-tracker extractions preserve behavior. Azure, speech practice, rate-limit, placement, and The Conversation provider refactors preserve request/scoring/storage/fallback/discovery behavior. Test helper refactors preserve assertions.

Validation:
- Known baseline before review: git --no-pager diff --check — passed.
- Known baseline before review: npm run typecheck -- --pretty false — passed.
- Ran: NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/today-session-types.test.ts tests/today-set-article.test.ts tests/today-set-article-route.test.ts tests/annotations.test.ts tests/display-format.test.ts tests/dictation.test.ts tests/speech-provider-azure.test.ts tests/speech-repository.test.ts tests/rate-limit.test.ts tests/rate-limit-store.test.ts tests/placement-route.test.ts tests/scraper-providers-discovery.test.ts tests/tags.test.ts tests/security-regressions-sanitization.test.ts tests/bookmarks.test.ts tests/routes.test.ts tests/reading-time-route.test.ts — 232 passed, 0 failed.

Recommended next batch focus: Continue with similarly scoped helper extraction, prioritizing modules that already have focused tests. For UI hooks/components, include nearby hook/component smoke tests or maintain strong typecheck coverage when runtime component tests are absent.

# Mouse scraper/eval/worker refactor pass

- Refactored only the permitted, previously untouched targets: `scripts/eval.ts`, `src/lib/scraper/fetch-browser.ts`, `src/lib/scraper/normalize.ts`, `src/lib/scraper/ssrf.ts`, and `src/lib/worker/loop.ts`.
- Kept behavior-preserving changes surgical: extracted CLI arg/default and failed-property helpers, browser route/challenge/context helpers, normalization sizing/transformation helpers, shared SSRF URL/IP normalization helpers, and worker stats/error helpers.
- Preserved eval CLI behavior, browser fetch normalization/SSRF checks, scraper type exports, and worker loop accounting/abort semantics.
- Validation passed: targeted node tests for eval/scraper/SSRF/browser/worker files, targeted ESLint on edited files, and eval CLI smoke (`npm run eval -- --feature quiz --json >/dev/null`).

# Switch test refactor 16

- Refactored only the requested untouched test files; no source files, branches, commits, or git notes were changed.
- `tests/review-session-reducer.test.ts`: extracted local session/phase helpers to remove repeated reducer fixture setup while preserving assertions and state-transition coverage.
- `tests/admin-scrape-routes.test.ts`: centralized route URLs/request builders and dynamic route loaders to reduce repeated setup without changing mocked auth/audit/security behavior.
- `tests/scraper-fetch-browser-core.test.ts`: extracted fetch queue, route action, and stream body helpers while preserving route filtering, retry-after, byte-limit, streaming, and POST forwarding assertions.
- `tests/db/postgres-privacy.test.ts`: centralized PostgreSQL enabled assertion, unique-constraint matcher, and reader user creation helper while preserving skipped integration semantics and database invariants.
- `tests/push-delivery.test.ts`: added a push subscription builder to reduce repeated fixture literals while preserving VAPID, send, pruning, and delivery tracking assertions.

Validation:
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-fetch-browser-core.test.ts tests/review-session-reducer.test.ts tests/admin-scrape-routes.test.ts tests/db/postgres-privacy.test.ts tests/push-delivery.test.ts` → pass: 51 passed, 6 skipped, 0 failed.
- `npx eslint tests/scraper-fetch-browser-core.test.ts tests/review-session-reducer.test.ts tests/admin-scrape-routes.test.ts tests/db/postgres-privacy.test.ts tests/push-delivery.test.ts` → pass.

# Tank backend refactor pass 16

- Refactored only the approved target files; initial target-file status was clean before editing.
- Preserved public exports and behavior while extracting private helpers for cloze token matching/masking, today article readiness/backup computation, flashcard due filters/view mapping, member command result/guard handling, and activity date/shield calculations.
- Validation: targeted backend tests passed; targeted ESLint passed. Full `npx tsc --noEmit --pretty false` was attempted and failed only on existing `tests/review-session-reducer.test.ts` AppState narrowing errors, not the touched backend files.

# Trinity UI refactor 16

- Refactored only the approved target files; all were clean before edits.
- Kept behavior unchanged: extracted local helpers/derived state for reader display options, mastery trend labels/counts, Today page booleans/title, admin ingest response handling, and nav filtering/active-path separator.
- Preserved UI routes, API calls, form fields, focus/keyboard semantics, reader behavior, and design-system primitives.

Validation:
- `npx eslint -- src/components/reader/ReaderDisplayPanel.tsx src/components/MasteryWidget.tsx 'src/app/(app)/today/page.tsx' src/components/AdminArticleIngest.tsx src/components/shell/nav-items.ts` — passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/shell-nav.test.ts` — passed (29/29).
- `npm run typecheck -- --pretty false` — failed on pre-existing/unrelated `tests/review-session-reducer.test.ts` AppState property errors; no target-file errors were reported before the failure.

# Morpheus Review — Refactor Batch 16

Verdict: APPROVE

Requested by: Ralph Agent
Reviewed at: 2026-07-03T04:37:07.319+00:00

## Findings

No blocking findings. The batch appears behavior-preserving across member admin guards, cloze masking, flashcard due queries, Today primary-article selection, activity/shield accounting, reader/admin UI extraction, navigation active matching, scraper/eval/normalization/SSRF/browser fetch helpers, worker loop stats/error handling, and the test-only refactors. Switch's focused type fix in `tests/review-session-reducer.test.ts` is type-safe and preserves reducer assertions.

## Validation

- Code review subagent for the batch files: no findings.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/cloze.test.ts tests/activity.test.ts tests/today-set-article.test.ts tests/scraper-normalize.test.ts tests/ssrf.test.ts tests/scraper-fetch-browser-core.test.ts tests/session-push-speech-worker.test.ts tests/admin-scrape-routes.test.ts tests/review-session-reducer.test.ts tests/push-delivery.test.ts tests/shell-nav.test.ts tests/ai-eval.test.ts tests/db/postgres-privacy.test.ts`
  - Result: PASS — 187 tests, 181 passed, 6 skipped, 0 failed.
- `npm run eval -- --feature quiz --json > artifacts-eval-batch16.json && node -e "const fs=require('fs'); const s=fs.readFileSync('artifacts-eval-batch16.json','utf8'); const i=s.indexOf('{'); const r=JSON.parse(s.slice(i)); if(r.mode!=='offline'||r.totals.score!==1) process.exit(1); console.log('eval quiz offline ok', r.totals.caseCount, r.totals.score);" && rm artifacts-eval-batch16.json`
  - Result: PASS — `eval quiz offline ok 2 1`.
- Baseline noted by requester, not rerun: `git --no-pager diff --check`; `npm run typecheck -- --pretty false`.

## Recommended next batch focus

Continue with narrowly scoped, high-test-coverage refactors around remaining API/provider boundaries and optional-provider fallbacks; keep scraper/security and worker changes paired with focused regression tests.

# Trinity controls refactor 17

- Refactored only untouched target UI files that existed in the worktree: `src/components/AdminMemberSupportActions.tsx`, `src/components/shell/UserMenu.tsx`, `src/components/ReaderToolsSurface.tsx`, and `src/components/KeyboardShortcutsModal.tsx`.
- Left `src/components/CommandPaletteItems.tsx` untouched because that target path does not exist; the nearby `src/components/command/CommandPaletteItems.tsx` was read for context but not edited because it was outside the explicit editable target list.
- Behavior-preserving changes: extracted typed support-action helpers and JSON download helper; hoisted stable menu classes/selectors and menu handlers; extracted reader tools focus/main-content inert helpers and stable IDs/selectors; hoisted keyboard-shortcuts modal constants and clarified shortcut key rendering.
- Validation: `npx eslint src/components/AdminMemberSupportActions.tsx src/components/shell/UserMenu.tsx src/components/ReaderToolsSurface.tsx src/components/KeyboardShortcutsModal.tsx` completed with exit code 0.

# Tank backend refactor 17

Author: Tank
Date: 2026-07-03T00:53:11.812+00:00
Requested by: Ralph Agent

## Decisions

- Kept edits limited to the five explicitly allowed target files; all were clean before editing.
- Preserved behavior by extracting private helpers only: dependency/content construction in text imports, scoring helpers in command items, SQL statement append/migration constants in DB helpers, anchor validation/rehydration helpers, and reminder payload/subscription grouping helpers in push scheduler.
- Did not change public semantics, logging/redaction payloads, command item data, DB cleanup/query behavior, annotation anchor output fields, or push scheduler delivery order/counting.

## Validation

- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/import-service.test.ts tests/command-items.test.ts tests/annotations.test.ts tests/push-reminder-scheduler.test.ts tests/db/postgres-migrations.test.ts` — passed: 64 pass, 2 skipped, 0 fail.
- `npx eslint src/lib/import/text-import.ts src/components/command/command-items.ts tests/db/support/db-helpers.ts src/lib/annotations/anchor.ts src/lib/push/scheduler.ts` — passed.

# Switch test refactor 17

- Refactored only the approved target test files: `tests/retention.test.ts`, `tests/today-session-generator.test.ts`, `tests/display-format.test.ts`, `tests/ai-ledger.test.ts`, and `tests/review-assets.test.ts`.
- Kept behavior/assertion intent unchanged by extracting local-only helpers for repeated date/cutoff assertions, Today session request builders, display-format formatting cases, AI fetch response mocking, and review-asset fixture/write helpers.
- Did not edit source files or non-target files. Other worktree modifications were left untouched.
- Validation passed with:
  `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/retention.test.ts tests/today-session-generator.test.ts tests/display-format.test.ts tests/ai-ledger.test.ts tests/review-assets.test.ts`
- Result: 89 tests passed, 0 failed.

# Mouse provider/safety refactor 17

- Target files were unmodified before editing, so this pass touched only the requested provider/safety/runtime files.
- Refactors are behavior-preserving: extracted shared scraper provider cleanup/quality types; centralized pronunciation select/validation/limit helpers; named redaction placeholders/limits; decomposed recommendation context DB/map assembly; centralized scraper duplicate/failed outcomes and quality-reject predicate.
- Preserved scraper type compatibility, pronunciation trimming/score validation, security redaction tokens/placeholders/limits, recommendation placement/adaptive/profile precedence, weak-word overlap counting, scraper duplicate/quality behavior, and profile goal-path semantics.
- Validation passed: targeted node tests for pronunciation, redaction, recommendation context/overlap, scraper index, scraper cleanup; full `npm run typecheck -- --pretty false`; targeted `npx eslint` on changed files.

# Morpheus Review: Refactor Batch 17

Verdict: APPROVE

Requested by: Ralph Agent
Reviewed at: 2026-07-03T00:53:11.812+00:00

## Findings

No blocking findings. The refactors are behavior-preserving: extracted helpers keep existing control flow and data shapes intact across import/text handling, command item fuzzy search, DB SQL helpers, annotation anchors, push reminders, reader/menu/modal controls, scraper types/index behavior, pronunciation validation/history, redaction, recommendation context assembly, and test helper refactors.

## Validation

- `npx eslint src/lib/import/text-import.ts src/components/command/command-items.ts tests/db/support/db-helpers.ts src/lib/annotations/anchor.ts src/lib/push/scheduler.ts src/components/AdminMemberSupportActions.tsx src/components/shell/UserMenu.tsx src/components/ReaderToolsSurface.tsx src/components/KeyboardShortcutsModal.tsx src/lib/scraper/types.ts src/lib/pronunciation.ts src/lib/security/redaction.ts src/lib/recommendations/context.ts src/lib/scraper/index.ts tests/retention.test.ts tests/today-session-generator.test.ts tests/display-format.test.ts tests/ai-ledger.test.ts tests/review-assets.test.ts` — passed (exit 0).
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test-reporter=spec --test tests/import-service.test.ts tests/command-items.test.ts tests/annotations.test.ts tests/highlights.test.ts tests/push-reminder-scheduler.test.ts tests/pronunciation-lib.test.ts tests/redaction.test.ts tests/recommendations-context.test.ts tests/recommendations-context-overlap.test.ts tests/scraper-index.test.ts tests/scraper.test.ts tests/retention.test.ts tests/today-session-generator.test.ts tests/display-format.test.ts tests/ai-ledger.test.ts tests/review-assets.test.ts` — passed: 269 tests, 14 suites, 0 failures.

Known baseline before this review remained accepted: `git --no-pager diff --check` and `npm run typecheck -- --pretty false`.

## Recommended next batch focus

Continue with high-churn refactors that have focused coverage, prioritizing small helper extractions in modules with existing tests before broader UI or route reshaping.

# Trinity UI Refactor 18

- Date: 2026-07-03T00:53:11.812+00:00
- Author: Trinity
- Requestor: Ralph Agent

## Decision

Performed behavior-preserving refactors only in the five allowed target files. All target files were unmodified before edits, so no existing worktree changes were overwritten.

## Refactor notes

- `src/components/command/CommandPaletteItems.tsx`: extracted category lookup and CEFR type guard helpers to remove inline casting in article metadata rendering.
- `src/app/onboarding/steps/StepPlacement.tsx`: extracted props interface and placement option visual-state mapping to replace the nested ternary while preserving radio behavior and answer reveal states.
- `src/components/CardBookmarkButton.tsx`: split remove-list and default bookmark toggle flows into focused helpers while preserving endpoints, optimistic state, DOM data attributes, and silent failure behavior.
- `src/components/ReaderControls.tsx`: extracted display panel surface selection and shared display-settings constants while preserving Popover-on-desktop and Sheet-on-mobile behavior.
- `src/components/flashcard/FlashcardFace.tsx`: extracted repeated flip-card classes plus context/article link rendering helpers while preserving flipped states, pronunciation controls, grading, and reader links.

## Validation

- `npx eslint src/components/command/CommandPaletteItems.tsx src/app/onboarding/steps/StepPlacement.tsx src/components/CardBookmarkButton.tsx src/components/ReaderControls.tsx src/components/flashcard/FlashcardFace.tsx` — passed.
- `git --no-pager diff --check -- src/components/command/CommandPaletteItems.tsx src/app/onboarding/steps/StepPlacement.tsx src/components/CardBookmarkButton.tsx src/components/ReaderControls.tsx src/components/flashcard/FlashcardFace.tsx` — passed.

No component-specific tests were found for these target files; no production build was run.

# Mouse scraper/storage/provider refactor pass

- Left `src/lib/scraper/quality-classifier-corpus.ts` untouched because it is explicitly generated/data-like; the header says harvested arrays are produced by `scripts/build-quality-corpus.ts` and should not be hand-edited.
- Refactored `src/lib/scraper/readability-extract.ts` by extracting text normalization and parsed-article shaping helpers; preserved null-return gates, wrapper unwrapping, and Readability extraction behavior.
- Refactored `src/lib/scraper/providers/propublica.ts` by extracting URL parsing and newest-daily-sitemap selection helpers; preserved sitemap ordering, duplicate handling, child-fetch failure tolerance, and cap behavior.
- Refactored `scripts/check-schema-parity.ts` by extracting migration-diff and schema-difference reporting helpers; preserved stdout/stderr messages and exit behavior.
- Refactored `src/lib/runtime-config/security.ts` by extracting comma-list/origin helpers and named constants; preserved trusted proxy, CSRF, security event, and audit retention behavior.

Validation:
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-readability-extract.test.ts tests/scraper-readability-mock.test.ts tests/scraper-providers-discovery.test.ts tests/config-runtime-env.test.ts && npm run schema:check-parity` — passed (31 tests; schema and migration parity OK).
- `npx eslint src/lib/scraper/readability-extract.ts src/lib/scraper/providers/propublica.ts scripts/check-schema-parity.ts src/lib/runtime-config/security.ts` — passed.

# Switch test refactor pass 18

- Date: 2026-07-03T00:53:11.812+00:00
- Author: Switch
- Requested by: Ralph Agent

## Decision

Performed behavior-preserving refactors only in the five permitted, previously untouched test files:

- `tests/scraper-provider-cleaned-html-inspection.test.ts`
- `tests/push-reminder-scheduler.test.ts`
- `tests/coverage-gate.test.ts`
- `tests/db/postgres-migrations.test.ts`
- `tests/content-sources.test.ts`

## Rationale

Kept changes surgical and local to test helpers/builders/table data. Preserved assertion intent, fixtures, mocks, provider cleanup semantics, push reminder edge cases, coverage gate scenarios, and PostgreSQL integration skip behavior. No source files or unrelated modified worktree files were edited.

## Validation

- `npx eslint tests/scraper-provider-cleaned-html-inspection.test.ts tests/push-reminder-scheduler.test.ts tests/coverage-gate.test.ts tests/db/postgres-migrations.test.ts tests/content-sources.test.ts` — passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scraper-provider-cleaned-html-inspection.test.ts tests/push-reminder-scheduler.test.ts tests/coverage-gate.test.ts tests/db/postgres-migrations.test.ts tests/content-sources.test.ts` — passed: 35 passed, 2 skipped, 0 failed.

# Tank backend refactor 18

- Refactored untouched target files only: `src/lib/testing/e2e-fixtures.ts`, `src/lib/profile/schema.ts`, `src/lib/runtime-config/security.ts`, and `src/lib/assets.ts`.
- Left `src/lib/engagement/today-session/index.ts` unchanged because it is already a clear barrel and the task explicitly required preserving today-session index exports.
- Kept fixture behavior intact by extracting helper constants/functions for session TTL, role display names, profile create payloads, article seed payloads, and the E2E tag without changing seeded values or delete order.
- Kept profile schema semantics intact by extracting controlled-value/topic/daily-goal/goal-path helpers while preserving errors, opt-in dailyGoal handling, and goalPath clear/omit behavior.
- Kept runtime security config intact by extracting comma-list/origin helpers and named constants for trusted app envs, CSRF disabled values, and event buffer max.
- Kept asset behavior intact by replacing repeated manifest reference strings with local constants only.

Validation:
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test --test-name-pattern "parseProfileInput|parseTopics|isOnboarded|ASSET|public asset|ICON|APPLE|FONT|OFFLINE|tokens\\.css|sw\\.js|runtime config leaf modules" tests/profile.test.ts tests/assets.test.ts tests/config-runtime-env.test.ts && npx eslint src/lib/testing/e2e-fixtures.ts src/lib/profile/schema.ts src/lib/runtime-config/security.ts src/lib/assets.ts` — passed (33 tests, eslint clean).
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --input-type=module -e "await Promise.all([import('./src/lib/testing/e2e-fixtures.ts'), import('./src/lib/profile/schema.ts'), import('./src/lib/runtime-config/security.ts'), import('./src/lib/assets.ts')]);"` — passed.
- `cat > .tank-refactor-tsconfig.json ...; npx tsc --project .tank-refactor-tsconfig.json --noEmit --pretty false; rm -f .tank-refactor-tsconfig.json` — passed for changed target files.
- `git --no-pager diff --check -- src/lib/testing/e2e-fixtures.ts src/lib/profile/schema.ts src/lib/runtime-config/security.ts src/lib/assets.ts` — passed.
- `npm run typecheck` — failed due pre-existing syntax errors in `tests/coverage-gate.test.ts` lines 37 and 49; no non-target files were edited.

### 2026-07-03T05-01-50: Fix CommandPalette ArticleMeta CEFR narrowing locally
**By:** Trinity
**What:** Fix CommandPalette ArticleMeta CEFR narrowing locally
**References:** src/components/command/CommandPaletteItems.tsx
**Why:** In src/components/command/CommandPaletteItems.tsx, ArticleMeta now stores article.difficulty in a local const before running isCefrLevel and passing it to CefrBadge. This preserves the existing rendering behavior while allowing TypeScript to narrow the value to CefrLevel instead of re-reading a nullable property after a boolean alias.

# Switch tests refactor 19

Refactored only the requested test files with behavior-preserving local helpers for repeated JSON, signal, fetched-URL, outcome-status, and article-id assertions. No files were skipped.

Validation passed:
- `npx eslint tests/scripts-scrapers.test.ts tests/scraper-rss-extractor.test.ts tests/routes-api-fallbacks.test.ts tests/scraper-quality-checks.test.ts tests/server-read-models-runtime.test.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/scripts-scrapers.test.ts tests/scraper-rss-extractor.test.ts tests/routes-api-fallbacks.test.ts tests/scraper-quality-checks.test.ts tests/server-read-models-runtime.test.ts`
- `git --no-pager diff --check`

# Tank scripts/feed refactor 19

Refactored only the requested files: `scripts/batch-synthesis.ts`, `scripts/scrape-review.ts`, `src/tools/api-catalog.ts`, and `src/lib/feed.ts`.

Result: behavior-preserving helper extraction for CLI arg parsing/query construction, scrape-review defaults/headers/DB filters, API catalog static-analysis helpers/constants, and feed data-loading/scoring pagination seams. No files were skipped.

Validation passed:
- `npx eslint scripts/batch-synthesis.ts scripts/scrape-review.ts src/tools/api-catalog.ts src/lib/feed.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/batch-synthesis.test.ts tests/scrape-review.test.ts tests/api-catalog-generation.test.ts tests/api-catalog-drift.test.ts tests/feed.test.ts`
- `npm run typecheck`
- `git --no-pager diff --check -- scripts/batch-synthesis.ts scripts/scrape-review.ts src/tools/api-catalog.ts src/lib/feed.ts`

# Trinity UI refactor 19

Date: 2026-07-03

Result: Behavior-preserving local refactors completed for WordLookup, CommandPalette, ListSwitcher, usePronunciationSession, and VocabularyJournal. Changes extracted small helpers/derived values only; no routes, API calls, UI states, or selection/focus semantics intentionally changed.

Validation:
- `npx eslint src/components/reader/wordLookup/WordLookup.tsx src/components/command/CommandPalette.tsx src/components/ListSwitcher.tsx src/components/pronunciation/usePronunciationSession.ts src/components/VocabularyJournal.tsx`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/command-navigation.test.ts tests/selection-helpers.test.ts`
- `git --no-pager diff --check`

# Mouse scraper refactor 19

Result: behavior-preserving scraper refactor completed for the requested files.

Changed:
- src/lib/scraper/declutter.ts
- src/lib/scraper/quality.ts
- src/lib/scraper/extract.ts
- src/lib/scraper/fetch-strategies.ts
- scripts/build-quality-corpus.ts

Skipped: none.

Validation:
- Targeted eslint on changed files passed.
- Targeted scraper tests passed: 177/177.
- git --no-pager diff --check passed.

# Tank scripts refactor 20

Changed files:
- scripts/scrape-undark.ts
- scripts/scrape-smithsonian.ts
- scripts/analyze-speech-alignment.ts
- scripts/check-node-coverage.ts
- scripts/scrape.ts

Skipped files: none.

Summary: behavior-preserving local helper/type extraction for visited record validation/defaults, coverage matching, outcome counting, coverage ratio/sorting, and scrape counters. No CLI flags, output formats, exit-code logic, retry/fallback behavior, or publish/import flow intentionally changed.

Validation:
- `npx eslint scripts/scrape-undark.ts scripts/scrape-smithsonian.ts scripts/analyze-speech-alignment.ts scripts/check-node-coverage.ts scripts/scrape.ts` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/coverage-gate.test.ts tests/scripts-scrapers.test.ts tests/scraper-undark-cli.test.ts tests/scraper-smithsonian-cli.test.ts` passed (31 tests).
- `git --no-pager diff --check` passed.

# Mouse backend refactor 20

Refactored all requested files only: difficulty scoring helpers, offline Today replay status helpers, Today comprehension helper extraction, Today completion word-review/timestamp helpers, and backfill option/planning helpers.

Validation passed:
- `npx eslint src/lib/difficulty.ts src/lib/offline/sync-runtime.ts src/lib/engagement/today-session/comprehension.ts src/lib/engagement/today-session/completion.ts src/lib/processing/backfill.ts`
- Targeted node tests for difficulty, backfill, processing pipeline, Today completion/comprehension, offline sync: 109 passed
- `git --no-pager diff --check`

No files skipped. No commit created.

# Switch tests refactor 20

Changed: tests/jobs-org-analytics-backend.test.ts, tests/offline-runtime.test.ts, tests/article-library-read-models.test.ts, tests/providers.test.ts, tests/today-comprehension.test.ts.
Skipped: none.
Validation: npx eslint on changed files passed; native node --test on changed files passed (69 tests); git --no-pager diff --check passed.

# Trinity UI refactor 20

- Refactored only the requested UI files: ArticleDictation, ArticlePronunciation, ListPickerPopover, TodayWorkflow, and admin article detail page.
- Preserved behavior while extracting local helpers/components for rendering, state-derived booleans, URL builders, and admin detail sections.
- Validation passed: targeted ESLint, focused nearest tests, TypeScript typecheck, and `git diff --check`.
- Skipped files: none.

# Mouse backend refactor 21

Changed:
- src/lib/observability/tracing.ts
- src/lib/engagement/today-session/skip.ts
- src/lib/engagement/today-session/target-words.ts
- src/lib/annotations/queries.ts
- src/lib/article-library/takedown.ts
- src/lib/ai/usage-summary.ts

Skipped:
- src/lib/recommendations/types.ts (types/constants only; no safe behavior-preserving cleanup needed)

Validation:
- `npx eslint src/lib/observability/tracing.ts src/lib/engagement/today-session/skip.ts src/lib/engagement/today-session/target-words.ts src/lib/annotations/queries.ts src/lib/article-library/takedown.ts src/lib/ai/usage-summary.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/tracing.test.ts tests/today-session-target-words.test.ts tests/today-skip.test.ts tests/content-policy.test.ts tests/ai-ledger.test.ts tests/server-read-models-runtime.test.ts`
- `git --no-pager diff --check`

Result: behavior-preserving local helper extraction/deduplication only; no public API or logging/privacy semantics changed.

# Tank provider refactor 21

Refactored five target files with behavior-preserving helper extraction/constants only:
- src/lib/ai/evals/live-runner.ts
- src/lib/scraper/providers/grist.ts
- src/lib/push/delivery.ts
- src/lib/vocabulary.ts
- src/lib/article-library/collections/commands.ts

Skipped:
- src/lib/ai/provider.ts (type/interface-only; no safe simplification needed)

Validation passed:
- npx eslint src/lib/ai/evals/live-runner.ts src/lib/scraper/providers/grist.ts src/lib/push/delivery.ts src/lib/vocabulary.ts src/lib/article-library/collections/commands.ts
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/ai-eval.test.ts tests/ai-eval-live-default.test.ts tests/scraper-providers-discovery.test.ts tests/scraper-rss-extractor.test.ts tests/providers.test.ts tests/push-delivery.test.ts tests/vocabulary.test.ts tests/bookmarks.test.ts tests/article-library-read-models.test.ts
- git --no-pager diff --check

# Switch tests refactor 21

- Refactored test-only helpers/table cases in:
  - tests/rate-limit.test.ts
  - tests/classroom-commands.test.ts
  - tests/tutor-markdown.test.ts
  - tests/recommendations-candidate-visibility.test.ts
  - tests/placement-route.test.ts
- Skipped files: none.
- Validation passed:
  - `npx eslint tests/rate-limit.test.ts tests/classroom-commands.test.ts tests/tutor-markdown.test.ts tests/recommendations-candidate-visibility.test.ts tests/placement-route.test.ts`
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/rate-limit.test.ts tests/classroom-commands.test.ts tests/tutor-markdown.test.ts tests/recommendations-candidate-visibility.test.ts tests/placement-route.test.ts`
  - `git --no-pager diff --check`

# Trinity UI refactor 21

Changed files:
- src/components/reader/wordLookup/highlightMarks.ts
- src/lib/use-roving-tabindex.ts
- src/lib/use-popover-position.ts
- src/components/SetTodayArticleButton.tsx
- src/components/ReaderProgress.tsx
- src/app/(app)/offline/OfflineLibraryClient.tsx
- src/components/ForYouFeed.tsx

Skipped files: none.

Validation:
- `npx eslint -- ...target files` passed.
- Focused tests passed: reader-highlight-marks, roving-tabindex, ui-segmented-control-index.
- `git --no-pager diff --check` passed.

# Mouse backend refactor 22

Changed:
- src/lib/engagement/streak.ts
- src/lib/account-lifecycle/member-list.ts
- src/lib/ai/input-safety.ts

Skipped:
- src/lib/engagement/today-session/index.ts (barrel-only; no safe behavior-preserving extraction identified)
- src/lib/leveling/types.ts (type/constant definitions already minimal)
- src/lib/i18n/catalog.ts (interface-only catalog shape; no safe behavior-preserving extraction identified)

Validation:
- `npx eslint src/lib/engagement/streak.ts src/lib/account-lifecycle/member-list.ts src/lib/ai/input-safety.ts` passed
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/activity.test.ts tests/ai-input-safety.test.ts tests/prompt-injection-evals.test.ts` passed (68 tests)
- `git --no-pager diff --check` passed

Notes:
- Refactors only extracted local helpers/constants and preserved public exports, data shapes, privacy/logging behavior, and optional-provider fallbacks.

# Tank services refactor 22

Changed files:
- src/lib/tutor-markdown.ts
- src/lib/sanitize.ts
- src/lib/learning/placement.ts
- src/lib/org/commands.ts
- src/lib/categories.ts
- src/lib/cache-version.ts
- src/lib/translation.ts
- src/lib/security/csrf.ts

Skipped files: none.

Summary: behavior-preserving local helper extraction/constants/type simplification only; public APIs and security/privacy fallbacks preserved.

Validation:
- `npx eslint src/lib/tutor-markdown.ts src/lib/sanitize.ts src/lib/learning/placement.ts src/lib/org/commands.ts src/lib/categories.ts src/lib/cache-version.ts src/lib/translation.ts src/lib/security/csrf.ts` passed.
- Targeted node tests passed: tutor-markdown, sanitize, placement-scorer, org, categories, cache-version, translation, csrf (105 tests).
- `git --no-pager diff --check` passed.
- Additional full `npx tsc --noEmit --pretty false` was blocked by unrelated existing syntax errors in `src/components/command/useCommandPaletteSearch.ts`.

# Trinity UI Refactor 22

Changed files:
- src/components/command/useCommandPaletteSearch.ts
- src/app/(app)/welcome/WelcomeTour.tsx
- src/components/command/useArticleSearch.ts
- src/components/StreakWidget.tsx
- src/components/DailyGoal.tsx
- src/components/GrammarPopover.tsx
- src/components/shell/MoreSheet.tsx
- src/app/(app)/settings/page.tsx

Skipped files: none.

Summary: behavior-preserving local-helper/type extraction and duplicate reduction only; no route/API/flow changes intended.

Validation:
- `npx --no-install eslint -- <changed files>` passed.
- Nearest tests: none obvious for the changed files.
- `git --no-pager diff --check` passed.
- Extra `npm run typecheck -- --pretty false` failed on pre-existing `tests/support/job-fake.ts` createdAt/updatedAt errors outside this task scope.

# Switch tests refactor 22

Changed files:
- tests/support/job-fake.ts
- tests/db/postgres-jobs.test.ts
- tests/support/react-hook-harness.ts
- tests/db/postgres-cascade.test.ts
- tests/db/postgres-org-classroom.test.ts
- tests/support/route.ts

Skipped files: none.

Validation:
- `npx eslint tests/support/job-fake.ts tests/db/postgres-jobs.test.ts tests/support/react-hook-harness.ts tests/db/postgres-cascade.test.ts tests/db/postgres-org-classroom.test.ts tests/support/route.ts` passed.
- Targeted native node tests passed: jobs, hook harness consumers, routes, and the three Postgres DB tests (DB integration cases skipped without RUN_DB_INTEGRATION).
- `git --no-pager diff --check` passed.

# Switch job fake type fix

- Fixed `tests/support/job-fake.ts` by explicitly typing the spread-built row in `makeJobRow` as `JobRow`, preserving fake behavior while restoring `createdAt`/`updatedAt` access.
- Validation passed:
  - `npx eslint tests/support/job-fake.ts`
  - `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/jobs.test.ts`
  - `npm run typecheck -- --pretty false`
  - `git --no-pager diff --check`

# Mouse backend refactor 23

Changed files:
- src/app/(app)/dashboard/view-model.ts
- src/lib/analytics/queries/repository.ts
- src/lib/theme.ts
- src/lib/engagement/reading-speed-repo.ts
- src/lib/aggregation.ts
- src/lib/analytics/admin.ts
- src/lib/result.ts

Skipped files: none.

Summary: behavior-preserving local helper/constant/type-guard extraction and duplication reduction only.

Validation:
- `npx eslint 'src/app/(app)/dashboard/view-model.ts' src/lib/analytics/queries/repository.ts src/lib/theme.ts src/lib/engagement/reading-speed-repo.ts src/lib/aggregation.ts src/lib/analytics/admin.ts src/lib/result.ts` passed.
- Focused node tests passed: aggregation, theme runtime, reading-speed repo, analytics queries, result.
- `git --no-pager diff --check` passed.
- `npm run typecheck` was attempted; it failed only on existing readonly-array errors in `tests/db/postgres-indexes.test.ts`.

# Tank services refactor 23

Refactored the eight requested backend/service files with local helper extraction and constants only. Preserved route shapes/statuses, validation semantics, classifier fallback behavior, practice attempt idempotency, logger merge/output behavior, and privacy-safe metadata. Validation passed: targeted ESLint, nearest targeted node tests, and `git --no-pager diff --check`.

# Switch test refactor 23

Changed files:
- tests/db/postgres-indexes.test.ts
- tests/support/learning-fixtures.ts
- tests/support/auth-mock.ts
- tests/support/prisma-mock.ts
- tests/db/support/fixtures.ts
- tests/db/support/explain-helpers.ts
- tests/db/postgres-search.test.ts
- tests/db/postgres-analytics.test.ts
- e2e/support/seed.ts
- tests/db/support/db-config.ts

Skipped files: none.

Validation:
- `npx eslint` on the changed files: passed.
- Targeted native node tests for changed DB tests and helper consumers: passed (138 passed, 3 PostgreSQL integration tests skipped without RUN_DB_INTEGRATION).
- `git --no-pager diff --check`: passed.

# Trinity UI refactor 23

Changed only requested files. Refactored sidebar nav link rendering, vocabulary display flags, inline note helpers, signin page sections, Section header rendering, admin sources table pieces, landing content constants/types, and list rename handlers.

Skipped: none.

Validation: targeted ESLint passed; targeted tests passed (content-sources, signin-helpers, shell-nav, list-name-validation); typecheck passed; git diff --check passed.

# Switch tests refactor 24

- Changed: `e2e/support/db-guard.ts` re-export formatting only; public behavior unchanged.
- Skipped: `tests/fixtures/coverage-gate/native-pass.fixture.ts` (no safe meaningful refactor found).
- Validation: `npx eslint e2e/support/db-guard.ts`; targeted native node tests `tests/e2e-seed-guard.test.ts` and `tests/storage-worker-runtime.test.ts`; `git --no-pager diff --check`.

# Mouse service refactor 24

Date: 2026-07-03

Changed:
- src/lib/security/headers.ts
- src/lib/search/query.ts
- src/lib/quiz.ts
- src/lib/learning/reading-exposure.ts
- src/lib/ai/output/moderation.ts
- src/lib/copy/push.ts
- src/lib/copy/goal-path.ts

Skipped:
- src/lib/scraper/quality-classifier-seed-corpus.ts (static seed corpus; no safe behavior-preserving cleanup needed)

Validation:
- Targeted ESLint passed for changed files.
- Targeted tests passed: route-policy, articles, articles-search, quiz, weak-word-reexposure, ai-moderation, push-reminder-scheduler, today-view-model, i18n-catalog.
- git diff --check passed.

# Trinity UI Refactor 24

Changed: `src/components/Sparkline.tsx`, `src/components/ArticleListingGrid.tsx`, `src/components/reader/study/useArticleVocabularyPanel.ts`, `src/components/command/useCommandNavigation.ts`, `src/components/command/CommandPaletteProvider.tsx`, `src/app/admin/tags/page.tsx`, `src/app/(app)/lists/page.tsx`, `src/components/ui/PageHeader.tsx`.

Skipped: none.

Result: behavior-preserving local helper extraction, clearer derivations/types, and duplicate reduction only.

Validation: targeted ESLint passed; nearest tests passed (50 tests); `git --no-pager diff --check` passed. Typecheck was attempted and failed on pre-existing errors outside touched files.

# Tank runtime refactor 24

Result: behavior-preserving refactor completed for the 8 requested files; no requested files skipped.

Changed: src/app/layout.tsx, src/app/global-error.tsx, src/app/api/admin/analytics/export/route.ts, src/lib/sentence-translation.ts, src/lib/ai/prompts/registry.ts, src/lib/ai/evals/types.ts, src/app/api/today/comprehension/route.ts, src/lib/runtime-config/observability.ts.

Validation: targeted ESLint passed; nearest tests passed (53/53); git diff --check passed. Full typecheck was attempted and remains blocked by pre-existing src/lib/search/query.ts TS2352 errors outside this task scope.

# Mouse search query type fix

- Updated `src/lib/search/query.ts` to keep the shared term-combining helper while moving provider-specific Prisma WHERE construction into typed callbacks.
- Removed the generic `TWhere` casts that triggered TS2352 without introducing `unknown`/`any` casts.
- Validation passed: `npx eslint src/lib/search/query.ts`; targeted search tests via Node test runner for `tests/articles-search.test.ts`, `tests/search.test.ts`, `tests/articles.test.ts`; `npm run typecheck -- --pretty false`; `git --no-pager diff --check`.

# Tank services refactor 25

- Refactored shared service helpers in the requested eight files only.
- Preserved public APIs and route/cache/registry/rate-limit/schema/storage/mapper behavior.
- Validation: targeted ESLint passed; focused node tests passed; additional org/rate-limit tests passed; `git --no-pager diff --check` passed.
- Note: full `npm run typecheck -- --pretty false` was attempted and failed on pre-existing unrelated errors in collection/classroom read models.

# Mouse backend refactor 25

Refactored only the requested backend/domain files with local helper extraction and clearer narrowings while preserving public APIs and behavior.

Changed files:
- src/lib/leveling/index.ts
- src/lib/recommendations/explanations.ts
- src/lib/analytics/queries/retention.ts
- src/lib/observability/tracing-node.ts
- src/lib/classroom/progress.ts
- src/lib/analytics/events/writer.ts
- src/lib/worker/registry.ts
- src/lib/article-library/collections/read-models.ts

Skipped files: none.

Validation:
- `npx eslint src/lib/leveling/index.ts src/lib/recommendations/explanations.ts src/lib/analytics/queries/retention.ts src/lib/observability/tracing-node.ts src/lib/classroom/progress.ts src/lib/analytics/events/writer.ts src/lib/worker/registry.ts src/lib/article-library/collections/read-models.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/leveling-adaptive.test.ts tests/leveling.test.ts tests/shared-validation-pure.test.ts tests/analytics-queries.test.ts tests/classroom-progress.test.ts tests/analytics.test.ts tests/session-push-speech-worker.test.ts tests/article-library-read-models.test.ts tests/bookmarks.test.ts`
- `npx tsc --noEmit --pretty false`
- `git --no-pager diff --check`

# Trinity UI refactor 25

Refactored eight requested files only, preserving behavior while extracting local helpers for loading lists, keyboard shortcut matching, listing skeleton indexes, reader listen state, flashcard grade config, teacher page sections, article header subparts, and highlight merge inputs.

Validation:
- `npx --no-install eslint src/hooks/useLoadMoreList.ts src/lib/use-keyboard-shortcut.ts src/components/route-states/ListingLoadingShell.tsx src/components/ReaderListenButton.tsx src/components/flashcard/GradeButtons.tsx 'src/app/(app)/teacher/page.tsx' 'src/app/(app)/reader/[id]/ArticleHeader.tsx' src/components/reader/wordLookup/useHighlightActions.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/listing-load-more.test.ts tests/load-more-list-hook.test.ts tests/keyboard-shortcut-hook.test.ts`
- `npm run typecheck -- --pretty false`
- `git --no-pager diff --check`

Skipped files: none.

# Mouse backend refactor 26

Refactored only the requested backend/platform files with behavior-preserving helper extraction and constants:
- `src/lib/ai/evals/evaluators/safety.ts`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/index.ts`
- `src/lib/route-policy.ts`
- `src/lib/client-error-reporter.ts`
- `src/lib/speech/timing-migration.ts`
- `src/lib/taxonomy/scope.ts`
- `src/lib/listing-cache.ts`

Skipped: none.

Validation passed:
- `npx eslint src/lib/ai/evals/evaluators/safety.ts src/lib/i18n/en.ts src/lib/i18n/index.ts src/lib/route-policy.ts src/lib/client-error-reporter.ts src/lib/speech/timing-migration.ts src/lib/taxonomy/scope.ts src/lib/listing-cache.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/i18n-catalog.test.ts tests/route-policy.test.ts tests/speech-timing-migration.test.ts tests/taxonomy-scope.test.ts tests/listing-cache.test.ts tests/shared-validation-pure.test.ts`
- `npm run typecheck -- --pretty false`
- `git --no-pager diff --check`

# Tank services refactor 26

Refactored six allowed service files with behavior-preserving helper extraction/constants: SRS scheduling, grammar fallback/context handling, Today local-date timezone loading, search ranking weights, worker handler/dependency assembly, and profile data shaping.

Skipped `src/lib/copy/pages.ts` and `src/lib/jobs/index.ts` because they are simple export/copy modules with no safe meaningful refactor needed.

Validation passed: targeted eslint on changed files; node tests for SRS, grammar, today-session local-date, worker, jobs, and goal-path privacy; `git --no-pager diff --check`; IDE diagnostics clean.

# Trinity UI refactor 26

Changed: `Popover.tsx`, `TutorMessageRows.tsx`, `AdminArticleTakedown.tsx`, `Button.tsx`, `useSaveWord.ts`, `ListCreateForm.tsx`, `Badge.tsx`, `reviewSessionReducer.ts`.

Skipped: none.

Validation: targeted ESLint passed; nearest tests passed (`review-session-reducer`, `ui-popover-navigation`); `git diff --check` passed.

# Tank domain refactor 27

- Changed: `src/lib/lexical/lookup.ts`, `src/lib/classroom/queries.ts`, `src/lib/bookmarkChanges.ts`, `src/lib/classroom/completions.ts`, `src/lib/auth-providers.ts`, `src/lib/vocabulary/schemas.ts`.
- Skipped: `src/lib/analytics/events/catalog.ts`, `src/lib/ai/prompts/index.ts` (barrel/constant catalogs; no safe behavior-preserving simplification needed).
- Validation: targeted ESLint passed; targeted node tests passed (55 tests); TypeScript typecheck passed; `git --no-pager diff --check` passed.

# Mouse backend refactor 27

- Changed: `src/lib/ai/output/error-classifier.ts`, `src/lib/offline/today-client.ts`, `src/lib/analytics/queries/range.ts`, `src/lib/ai/registry.ts`, `src/lib/classroom/commands.ts`, `src/lib/push/provider.ts`, `src/lib/jobs/admin-commands.ts`.
- Skipped: `src/lib/observability/index.ts` (public barrel only; no safe local refactor needed).
- Validation: targeted ESLint passed; nearest tests passed (81 tests); `git --no-pager diff --check` passed.

# Trinity UI refactor 27

Changed files:
- src/components/ArticleDifficultyFeedback.tsx
- src/components/pronunciation/WordDisplay.tsx
- src/components/ListingBookmarkSync.tsx
- src/app/onboarding/steps/StepReview.tsx
- src/components/reader/usePronunciationAssessment.ts
- src/app/(app)/import/PersonalImports.tsx
- src/app/(app)/browse/page.tsx
- src/components/ui/Card.tsx

Skipped files: none.

Validation:
- `npx eslint ...target files` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/listing-load-more.test.ts tests/article-mastery.test.ts` passed.
- `npm run typecheck -- --pretty false` passed.
- `git --no-pager diff --check` passed.

# Tank service refactor 28

Result: behavior-preserving refactor completed for all 8 requested files; no files skipped.

Changed files:
- src/lib/analytics/events/sanitize.ts
- src/lib/runtime-config/rate-limit.ts
- src/lib/pwa/constants.ts
- src/lib/frequency-ranks.ts
- src/app/api/vocabulary/export/route.ts
- src/app/api/feed/route.ts
- src/lib/primitives/pure.ts
- src/app/api/speech/token/route.ts

Validation:
- npx eslint src/lib/analytics/events/sanitize.ts src/lib/runtime-config/rate-limit.ts src/lib/pwa/constants.ts src/lib/frequency-ranks.ts src/app/api/vocabulary/export/route.ts src/app/api/feed/route.ts src/lib/primitives/pure.ts src/app/api/speech/token/route.ts
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/analytics.test.ts tests/redaction.test.ts tests/config-runtime-env.test.ts tests/pwa-drift.test.ts tests/frequency.test.ts tests/feed-route.test.ts tests/pronunciation-speech-token.test.ts tests/shared-validation-pure.test.ts
- git --no-pager diff --check

# Trinity UI refactor 28

Changed files:
- src/components/admin/BarChart.tsx
- src/components/ListingProgressSync.tsx
- src/components/ErrorScreen.tsx
- src/components/ui/EmptyState.tsx
- src/components/shell/useSidebarState.ts
- src/components/reader/useNarrationApi.ts
- src/components/ui/Field.tsx
- src/components/shell/BottomTabBar.tsx

Skipped files: none.

Summary: behavior-preserving local refactors extracting constants/helpers and clearer prop/response types while preserving UI classes, routes, API calls, narration/listing sync behavior, sidebar/bottom-tab behavior, and primitive APIs.

Validation:
- `npx eslint src/components/admin/BarChart.tsx src/components/ListingProgressSync.tsx src/components/ErrorScreen.tsx src/components/ui/EmptyState.tsx src/components/shell/useSidebarState.ts src/components/reader/useNarrationApi.ts src/components/ui/Field.tsx src/components/shell/BottomTabBar.tsx` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/shell-nav.test.ts` passed (29 tests).
- `git --no-pager diff --check` passed.

# Mouse backend refactor 28

Changed files:
- src/lib/scraper/providers/bbc.ts
- src/app/api/admin/jobs/backfill/route.ts
- src/app/api/client-errors/route.ts
- src/app/api/admin/articles/ingest/route.ts
- src/lib/metrics/recorders/ai.ts
- src/lib/jobs/claim-postgres.ts
- src/lib/reader/route-guard.ts
- src/lib/auth-core.ts

Skipped files: none.

Validation passed:
- targeted ESLint on changed files
- npm run typecheck
- nearest targeted node tests (82 passing)
- git --no-pager diff --check

# Tank service refactor 29

Refactored local helpers in retention, quiz grading, Today word-review route, reader progress route, E2E DB guard, offline IndexedDB, and generic job claiming while preserving behavior and response shapes.

Skipped `src/lib/classroom/index.ts` because it is a barrel-only public API surface with no safe local simplification.

Validation: targeted ESLint passed; targeted node tests passed (86 tests); `git --no-pager diff --check` passed.

# Mouse backend refactor 29

Changed:
- src/lib/scraper/rss.ts
- src/lib/classroom/student-reads.ts
- src/app/api/today/set-article/route.ts
- src/app/api/reader/[id]/offline/route.ts
- src/lib/search/providers.ts
- src/lib/metrics/exporter.ts

Skipped:
- src/lib/lexical/index.ts (public barrel only; no safe behavior-preserving refactor needed)
- src/lib/annotations/index.ts (public barrel only; no safe behavior-preserving refactor needed)

Validation:
- npx eslint src/lib/scraper/rss.ts src/lib/lexical/index.ts src/lib/classroom/student-reads.ts src/app/api/today/set-article/route.ts 'src/app/api/reader/[id]/offline/route.ts' src/lib/search/providers.ts src/lib/annotations/index.ts src/lib/metrics/exporter.ts
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/bbc-rss.test.ts tests/classroom-student-reads.test.ts tests/today-set-article-route.test.ts tests/metrics-exporter.test.ts tests/articles-search.test.ts tests/server-read-models-runtime.test.ts tests/routes-api-fallbacks.test.ts tests/security-regressions-sanitization.test.ts
- npx tsc --noEmit --pretty false
- git --no-pager diff --check

Result: all validation passed.

# Trinity UI refactor 29

Changed: admin security page, marketing MockReaderCard, IconButton, useReaderPrefs, tag page, RailScroller, StepLevel, AdminArticleActions.
Skipped: none.
Validation: targeted ESLint passed; nearest node tests passed (reader-prefs, tags, security-events); TypeScript typecheck passed; git diff --check passed.

# Mouse backend refactor 30

Changed files:
- src/lib/visited.ts
- src/lib/leveling/cefr-primitives.ts
- src/lib/auth.ts
- src/lib/tenant-api.ts
- src/lib/push/commands.ts
- src/lib/ai/retention.ts
- src/lib/recommendations/diversity.ts

Skipped files:
- src/lib/engagement/index.ts (barrel-only; no safe behavior-preserving extraction needed)

Validation:
- npx eslint src/lib/visited.ts src/lib/leveling/cefr-primitives.ts src/lib/auth.ts src/lib/tenant-api.ts src/lib/push/commands.ts src/lib/ai/retention.ts src/lib/recommendations/diversity.ts
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/retention.test.ts tests/recommendations.test.ts tests/difficulty.test.ts tests/auth-security-backend.test.ts tests/auth-providers.test.ts tests/org-routes.test.ts tests/classroom-routes.test.ts
- git --no-pager diff --check

All validation passed. No commits made.

# Trinity UI refactor 30

- Date: 2026-07-03
- Changed: `src/app/terms/page.tsx`, `src/app/(app)/progress/_sections/ProgressOverviewSection.tsx`, `src/components/pronunciation/PronunciationResult.tsx`, `src/components/DashboardWelcomeBanner.tsx`, `src/app/(app)/reader/[id]/page.tsx`, `src/features/profile-preferences/DailyGoalStepper.tsx`, `src/components/flashcard/FlashcardPrimitives.tsx`, `src/components/ui/Select.tsx`.
- Skipped: none.
- Summary: behavior-preserving local refactors for repeated text rendering, small pure helpers, clearer derivations/types, and unchanged design-token/primitives usage.
- Validation: targeted ESLint passed; nearest reader tests passed (59 tests); `npm run typecheck` passed; `git --no-pager diff --check` passed.

# Tank routes refactor 30

Refactored only the requested route/query/admin overview files with local helpers and constants while preserving response shapes, statuses, query behavior, fallbacks, audit metadata, and privacy constraints.

Changed files:
- src/app/api/articles/import/route.ts
- src/app/api/search/route.ts
- src/app/api/admin/scrape/trigger/route.ts
- src/app/api/study/cloze/route.ts
- src/app/api/pronunciation/attempt/route.ts
- src/app/api/admin/members/[id]/route.ts
- src/lib/jobs/queries.ts
- src/lib/admin/overview.ts

Skipped files: none.

Validation:
- npx eslint on changed files: passed
- Targeted node tests for import/search/admin scrape/pronunciation/jobs/cloze/admin members: passed (89 tests)
- npx tsc --noEmit --pretty false: passed
- git --no-pager diff --check: passed

# Tank routes refactor 31

- Refactored all 8 requested files with behavior-preserving local helper extraction/constants and one unused type-import cleanup.
- Skipped files: none.
- Validation: targeted ESLint passed; targeted route tests passed (67 tests); `git --no-pager diff --check` passed.
- Notes: no public API/response shape, auth, visibility, audit metadata privacy, Today/study/admin/report/takedown semantics, or optional-provider fallback changes intended.

# Mouse backend refactor 31

Changed files:
- src/lib/learning/primitives.ts
- src/lib/import/schemas.ts
- src/lib/engagement/heatmap.ts
- src/lib/analytics/queries/segments.ts
- src/lib/worker/types.ts
- src/lib/runtime-config/feature-flags.ts
- src/lib/storage/filesystem.ts
- src/lib/analytics/events/retention.ts

Skipped files: none.

Summary: behavior-preserving helper/constant extraction and clearer type narrowings only; no API, schema, analytics, heatmap, worker export, runtime-config, storage, or retention semantic changes intended.

Validation:
- npx eslint src/lib/learning/primitives.ts src/lib/import/schemas.ts src/lib/engagement/heatmap.ts src/lib/analytics/queries/segments.ts src/lib/worker/types.ts src/lib/runtime-config/feature-flags.ts src/lib/storage/filesystem.ts src/lib/analytics/events/retention.ts
- NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/heatmap.test.ts tests/shared-validation-pure.test.ts tests/analytics-queries.test.ts tests/feature-flags.test.ts tests/storage.test.ts tests/storage-contract.test.ts tests/job-worker.test.ts tests/analytics.test.ts tests/retention.test.ts tests/storage-worker-runtime.test.ts
- git --no-pager diff --check

# Trinity UI refactor 31

Changed only requested source files with behavior-preserving local helper extraction and duplicate reduction.

Changed:
- src/app/(app)/study/words/page.tsx
- src/components/tutor/useAutoScrollLog.ts
- src/components/route-states/SegmentError.tsx
- src/components/reader/wordLookup/selectionHelpers.ts
- src/app/privacy/page.tsx
- src/components/reader/useLoopSegment.ts
- src/components/reader/useAudioRangePlayback.ts
- src/components/reader/wordLookup/useSentenceTranslation.ts

Skipped: none.

Validation:
- npx eslint on changed files: passed
- tests/selection-helpers.test.ts and tests/study-words-read-models.test.ts: passed
- git --no-pager diff --check on changed files: passed
- IDE diagnostics: none

# Tank domain refactor 32

Refactored small local helpers/constants in:
- `src/lib/bilingual.ts`
- `src/lib/article-library/collections/membership.ts`
- `src/app/api/reader/[id]/difficulty-feedback/route.ts`
- `src/app/api/level-recommendation/route.ts`
- `src/lib/reader/commands.ts`
- `src/app/api/today/route.ts`
- `src/lib/progress-helpers.ts`

Skipped `src/lib/storage/types.ts` because it is type/export contract-only and had no safe behavior-preserving simplification.

Validation passed:
- Targeted ESLint on requested files
- Targeted node tests: `tests/bilingual.test.ts`, `tests/article-library-read-models.test.ts`, `tests/bookmarks.test.ts`, `tests/difficulty-feedback-route.test.ts`, `tests/misc-routes.test.ts`, `tests/today-summary-route.test.ts`
- `git --no-pager diff --check`

# Mouse backend refactor 32

Changed:
- `src/lib/metrics/recorders/security.ts`
- `src/lib/push/schemas.ts`
- `src/lib/org/queries.ts`
- `src/lib/metrics/route-groups.ts`
- `src/lib/session.ts`
- `src/lib/metrics/recorders/jobs.ts`
- `src/app/api/today/read-complete/route.ts`
- `src/app/api/reader/[id]/highlights/route.ts`

Skipped: none.

Validation:
- Targeted ESLint on changed files passed.
- Targeted tests passed: metrics route groups/metrics, push schemas, org/jobs analytics, today read-complete/rollout, highlights, session/RBAC.
- `git --no-pager diff --check` passed.
- `npm run typecheck` was attempted and failed on unrelated pre-existing `src/components/AdminJobActions.tsx` type error.

# Trinity UI refactor 32

Changed behavior-preserving refactors in:
- src/components/analytics/WeeklyBars.tsx
- src/components/AdminJobActions.tsx
- src/components/ui/Sheet.tsx
- src/components/ui/Avatar.tsx
- src/components/marketing/LandingHeroSection.tsx
- src/components/ArticleHero.tsx
- src/app/(app)/series/page.tsx
- src/app/(app)/progress/view-model.ts

Skipped: none.

Validation:
- `npx eslint -- src/components/analytics/WeeklyBars.tsx src/components/AdminJobActions.tsx src/components/ui/Sheet.tsx src/components/ui/Avatar.tsx src/components/marketing/LandingHeroSection.tsx src/components/ArticleHero.tsx 'src/app/(app)/series/page.tsx' 'src/app/(app)/progress/view-model.ts'` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/fluency-analytics-privacy.test.ts` passed.
- `git --no-pager diff --check` passed.

# Trinity admin job actions type fix

Fixed `src/components/AdminJobActions.tsx` by explicitly typing the job action POST helper as `Promise<void>` via `postJson<void>`, preserving the existing run/confirm behavior while satisfying `useAdminAction` and `ConfirmAction` callback contracts.

Validation passed:
- `npx eslint src/components/AdminJobActions.tsx`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/admin-jobs.test.ts tests/admin-jobs-routes.test.ts`
- `npm run typecheck -- --pretty false`
- `git --no-pager diff --check`

# Mouse backend refactor 33

- Changed: `src/lib/article-library/listing-response.ts`, `src/lib/search/annotations.ts`, `src/lib/push/subscription-health.ts`, `src/lib/prisma.ts`.
- Skipped as clean barrels/type contracts: `src/lib/storage/types.ts`, `src/lib/ai/index.ts`, `src/lib/org/index.ts`, `src/lib/recommendations/index.ts`.
- Refactor summary: extracted local option/id helpers, annotation empty/unique/presence helpers, push subscription ID filter helpers, and Prisma client factory helpers without changing public APIs or response shapes.
- Validation: targeted ESLint passed; `tests/search.test.ts`, `tests/push-delivery.test.ts`, and `tests/articles-search.test.ts` passed; `git --no-pager diff --check` passed.

# Trinity UI refactor 33

Refactored the requested eight UI/frontend files only. Changes are behavior-preserving extractions of local helpers/components for dashboard Today/For You/progress, assignments cards, vocabulary row derivations, offline sync indicator state/CTA, Toolbar class composition, and marketing feature accent handling.

Skipped files: none.

Validation:
- `npx eslint -- <8 changed files>` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/vocabulary.test.ts tests/offline-sync.test.ts` passed (22 tests).
- `git --no-pager diff --check` passed.

# Tank service refactor 33

Changed files:
- src/lib/metrics/recorders/content.ts
- src/lib/frequency.ts
- src/lib/engagement/time.ts
- src/lib/copy/site.ts
- src/lib/supported-languages.ts
- src/lib/storage/key.ts
- src/lib/runtime-config/oauth.ts
- src/lib/runtime-config/dictionary.ts

Skipped files: none.

Result: behavior-preserving local refactors only; metrics names/labels, frequency lookup, engagement time bucketing, copy strings, language support, storage key handling, OAuth config, and dictionary fallbacks preserved.

Validation:
- `npx eslint src/lib/metrics/recorders/content.ts src/lib/frequency.ts src/lib/engagement/time.ts src/lib/copy/site.ts src/lib/supported-languages.ts src/lib/storage/key.ts src/lib/runtime-config/oauth.ts src/lib/runtime-config/dictionary.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/frequency.test.ts tests/engagement-time.test.ts tests/storage-worker-runtime.test.ts tests/config-runtime-env.test.ts tests/metrics.test.ts tests/translation.test.ts tests/legal-content.test.ts`
- `git --no-pager diff --check -- src/lib/metrics/recorders/content.ts src/lib/frequency.ts src/lib/engagement/time.ts src/lib/copy/site.ts src/lib/supported-languages.ts src/lib/storage/key.ts src/lib/runtime-config/oauth.ts src/lib/runtime-config/dictionary.ts`

# Trinity UI refactor 34

Refactored the requested files with behavior-preserving local extractions and constants only.

Changed: `src/hooks/useMutation.ts`, `src/components/pronunciation/ScoreRing.tsx`, `src/components/ReaderPanelErrorBoundary.tsx`, `src/components/ui/Tooltip.tsx`, `src/components/ui/Input.tsx`, `src/components/shell/HeaderSearch.tsx`, `src/components/ui/Inline.tsx`, `src/components/CardThumbnail.tsx`.

Skipped: none.

Validation: targeted eslint passed; no nearest existing tests found; `git --no-pager diff --check` passed.

# Mouse backend refactor 34

Changed: src/lib/runtime-config/speech.ts, src/lib/jobs/retry-policy.ts, src/lib/api-auth.ts, src/app/api/reports/route.ts, src/app/api/admin/jobs/[id]/route.ts, src/lib/jobs/claim.ts, src/lib/classroom/guards.ts, src/app/api/series/[id]/enroll/route.ts.

Skipped: none.

Validation: targeted ESLint passed; targeted nearest tests passed (80); typecheck passed; git diff --check passed.

# tank-service-refactor-34

Refactored seven requested files with local helper extraction/constants while preserving behavior: NBC/Time/HuffPost provider configs, org slug helpers, reading-time route, tutor route, and highlight route. Skipped `src/lib/primitives/client.ts` because it is already a minimal client-only barrel with no safe structural simplification. Validation passed: targeted ESLint, nearest route/provider/org tests (96 passing), TypeScript typecheck, and `git --no-pager diff --check`.

# Trinity UI Refactor 35

Changed files:
- src/hooks/useReadingListMutations.ts
- src/components/pronunciation/ScoreRing.tsx
- src/components/ReaderPanelErrorBoundary.tsx
- src/components/ui/Tooltip.tsx
- src/components/ui/Input.tsx
- src/components/shell/HeaderSearch.tsx
- src/components/ui/Inline.tsx
- src/components/CardThumbnail.tsx

Skipped files: none of the requested files were pre-modified at start.

Validation:
- `npx eslint -- src/hooks/useReadingListMutations.ts src/components/pronunciation/ScoreRing.tsx src/components/ReaderPanelErrorBoundary.tsx src/components/ui/Tooltip.tsx src/components/ui/Input.tsx src/components/shell/HeaderSearch.tsx src/components/ui/Inline.tsx src/components/CardThumbnail.tsx`
- `npm run typecheck -- --pretty false`
- `git --no-pager diff --check`

Nearest existing tests: none found for the targeted components/hooks.

# Tank services refactor 35

Changed files:
- src/lib/learner-landing.ts
- src/lib/jobs/errors.ts
- src/lib/ai/prompts/translation.ts
- src/lib/ai/evals/evaluators/tutor.ts
- src/app/api/push/unsubscribe/route.ts
- src/lib/import/quota.ts
- src/app/robots.ts
- src/app/api/reader/[id]/speech/audio/route.ts

Skipped files: none.

Validation:
- Targeted eslint passed for all changed files.
- Focused tests passed: tests/today-learner-landing.test.ts, tests/jobs.test.ts, tests/prompts.test.ts, tests/shared-validation-pure.test.ts, tests/push-routes.test.ts, tests/push-unsubscribe-route-errors.test.ts, tests/import-service.test.ts, tests/speech-audio-route.test.ts.
- npm run typecheck passed.
- git --no-pager diff --check passed.

# Mouse backend refactor 35

Refactored six allowed backend/service files with behavior-preserving helper extraction and constants:
- `src/lib/metrics/recorders/api.ts`
- `src/lib/article-library/collections/schemas.ts`
- `src/app/api/admin/sources/[key]/route.ts`
- `src/lib/storage/runtime.ts`
- `src/lib/signin-helpers.ts`
- `src/lib/csv.ts`

Skipped clean barrels:
- `src/lib/security/index.ts`
- `src/lib/metrics/index.ts`

Validation passed:
- `npx eslint src/lib/metrics/recorders/api.ts src/lib/article-library/collections/schemas.ts 'src/app/api/admin/sources/[key]/route.ts' src/lib/storage/runtime.ts src/lib/signin-helpers.ts src/lib/csv.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/signin-helpers.test.ts tests/shared-validation-pure.test.ts tests/article-library-read-models.test.ts tests/storage.test.ts tests/storage-contract.test.ts tests/metrics.test.ts`
- `npx tsc --noEmit --pretty false`
- `git --no-pager diff --check`

# Mouse backend refactor 36

- Changed: `src/lib/metrics/recorders/worker.ts`, `src/lib/media-blob.ts`, `src/lib/ai/evals/report.ts`, `src/lib/storage/registry.ts`, `src/lib/runtime-config/push.ts`, `src/lib/backoff.ts`.
- Skipped: `src/lib/storage.ts`, `src/lib/runtime-config/index.ts` (clean barrels; no safe value-add refactor).
- Validation: targeted ESLint passed; targeted tests passed (`metrics`, `media-blob`, `ai-eval`, `shared-validation-pure`, `storage-worker-runtime`, `config`, `backoff`); `git --no-pager diff --check` passed.

# Tank services refactor 36

Changed only the requested service/prompt/eval files. Extracted local prompt constants/render helpers, route payload/summary helpers, and eval helper constants/functions while preserving response shapes, statuses, prompt semantics, optional-provider fallback behavior, and privacy metadata constraints.

Validation passed:
- `npm exec -- eslint src/lib/ai/prompts/quiz.ts src/app/api/vocabulary/save/route.ts src/app/api/gamification/summary/route.ts src/lib/ai/prompts/vocabulary.ts src/lib/ai/prompts/tutor.ts src/lib/ai/evals/datasets.ts src/lib/ai/evals/assertions.ts src/lib/ai/prompts/tags.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/prompts.test.ts tests/ai-eval.test.ts tests/shared-validation-pure.test.ts tests/routes.test.ts tests/gamification.test.ts`
- `git --no-pager diff --check`

Skipped files: none.

# Trinity UI refactor 36

Changed behavior-preserving refactors in the requested eight component/hook files only: extracted local constants/helpers/types and reduced duplication without changing props, APIs, routes, persistence, or UI semantics.

Validation:
- `npx eslint src/components/SkeletonCard.tsx src/components/teacher/AssignArticleForm.tsx src/components/ArticleStudySection.tsx src/components/reader/usePronunciationPersistence.ts src/components/lists/ListDeleteControl.tsx src/components/StudyPlanSection.tsx src/components/AdminMemberActions.tsx src/components/ui/Textarea.tsx`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/study-plan.test.ts tests/pronunciation-routes.test.ts tests/admin-members.test.ts tests/classroom-routes.test.ts`
- `git --no-pager diff --check HEAD~1 -- src/components/SkeletonCard.tsx src/components/teacher/AssignArticleForm.tsx src/components/ArticleStudySection.tsx src/components/reader/usePronunciationPersistence.ts src/components/lists/ListDeleteControl.tsx src/components/StudyPlanSection.tsx src/components/AdminMemberActions.tsx src/components/ui/Textarea.tsx`

# Mouse media blob type fix

- Fixed `src/lib/media-blob.ts` by converting decoded bytes to an `ArrayBuffer` `BlobPart` before constructing `Blob`, avoiding unsafe `any` and preserving Blob URL behavior.
- Validation passed: `npx eslint src/lib/media-blob.ts`; nearest `tests/media-blob.test.ts`; `npm run typecheck -- --pretty false`; `git --no-pager diff --check`.

# Mouse backend refactor 37

Changed files:
- src/lib/auth-bootstrap.ts
- src/lib/ai/prompts/grammar.ts
- src/lib/ai/evals/evaluators/translation.ts
- src/lib/reader-referrer.ts
- src/lib/engagement/heatmap-repo.ts
- src/lib/ai/evals/evaluators/vocabulary.ts
- src/lib/worker/sleep.ts

Skipped files:
- src/lib/article-library/index.ts (clean barrel; no safe behavior-preserving refactor needed)

Validation:
- `npx eslint src/lib/auth-bootstrap.ts src/lib/ai/prompts/grammar.ts src/lib/ai/evals/evaluators/translation.ts src/lib/reader-referrer.ts src/lib/engagement/heatmap-repo.ts src/lib/ai/evals/evaluators/vocabulary.ts src/lib/worker/sleep.ts` passed
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/auth-bootstrap.test.ts tests/heatmap-repo.test.ts tests/storage-worker-runtime.test.ts tests/shared-validation-pure.test.ts` passed
- `git --no-pager diff --check` passed

# Tank routes refactor 37

Changed files:
- src/app/api/admin/tags/[id]/merge/route.ts
- src/app/api/reader/[id]/quiz/history/route.ts
- src/app/api/reader/[id]/grammar/route.ts
- src/app/api/classrooms/route.ts
- src/app/api/highlights/[id]/review-card/route.ts
- src/app/api/dictionary/route.ts
- src/app/api/admin/ai/usage/route.ts
- src/app/api/reader/[id]/vocabulary/route.ts

Skipped files: none.

Summary: behavior-preserving local helper/constant extraction and unused import cleanup; preserved auth/visibility checks, response shapes/statuses, analytics privacy, best-effort mastery behavior, cache revalidation, and optional-provider semantics.

Validation:
- `npx eslint 'src/app/api/admin/tags/[id]/merge/route.ts' 'src/app/api/reader/[id]/quiz/history/route.ts' 'src/app/api/reader/[id]/grammar/route.ts' 'src/app/api/classrooms/route.ts' 'src/app/api/highlights/[id]/review-card/route.ts' 'src/app/api/dictionary/route.ts' 'src/app/api/admin/ai/usage/route.ts' 'src/app/api/reader/[id]/vocabulary/route.ts'` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/routes.test.ts tests/classroom-routes.test.ts tests/security-regressions-idor.test.ts tests/quiz-mastery-routes.test.ts tests/ai-budget.test.ts` passed (83 tests).
- `npm run typecheck` passed.
- `git --no-pager diff --check` passed.

# Trinity UI refactor 37

Refactored eight requested UI/frontend files with behavior-preserving local helpers and clearer component/type boundaries.

Changed:
- `src/components/admin/RetentionTable.tsx`
- `src/components/tutor/TutorMarkdownRenderer.tsx`
- `src/app/(app)/progress/_sections/QuizTrendSection.tsx`
- `src/components/shell/ThemeToggle.tsx`
- `src/components/ReaderTutorProvider.tsx`
- `src/app/signin/SignInButtons.tsx`
- `src/components/ui/ReaderToolPanelState.tsx`
- `src/components/StudyPageShell.tsx`

Skipped: none.

Validation:
- `npx eslint -- <changed files>` passed.
- `npm run typecheck -- --pretty false` passed.
- Focused tests passed: `tests/tutor-markdown.test.ts`, `tests/theme-runtime.test.ts`, `tests/signin-helpers.test.ts`, `tests/progress.test.ts`.
- `git --no-pager diff --check` passed.

# Trinity UI refactor 38

Refactored 8 requested UI/reader files with behavior-preserving local helpers and small type cleanups. Skipped: none.

Validation:
- `npx eslint src/components/ui/Switch.tsx src/components/reader/wordLookup/useGrammarExplanation.ts src/components/flashcard/ReviewStartCard.tsx src/components/flashcard/ReviewProgress.tsx src/components/pronunciation/SubScoreBars.tsx src/components/analytics/StatCard.tsx src/components/Wordmark.tsx 'src/app/(app)/reader/[id]/KeepReadingSection.tsx'`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/grammar.test.ts`
- `git --no-pager diff --check`

# Tank routes refactor 38

Refactored the requested route/config/eval files only with behavior-preserving local helper extraction and constants.

Changed files:
- src/app/api/pronunciation/history/route.ts
- src/app/api/lists/[id]/route.ts
- src/app/api/admin/sources/sync/route.ts
- src/app/api/admin/reports/route.ts
- src/lib/runtime-config/analytics.ts
- src/lib/ai/evals/registry.ts
- src/app/api/push/preferences/route.ts
- src/app/api/orgs/route.ts

Skipped files: none.

Validation:
- `npx eslint src/app/api/pronunciation/history/route.ts 'src/app/api/lists/[id]/route.ts' src/app/api/admin/sources/sync/route.ts src/app/api/admin/reports/route.ts src/lib/runtime-config/analytics.ts src/lib/ai/evals/registry.ts src/app/api/push/preferences/route.ts src/app/api/orgs/route.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/pronunciation-routes.test.ts tests/bookmarks-routes.test.ts tests/content-routes.test.ts tests/config-runtime-env.test.ts tests/ai-eval.test.ts tests/reminder-preferences.test.ts tests/org-routes.test.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/content-reports.test.ts tests/org.test.ts`
- `git --no-pager diff --check`

All validation passed.

# Mouse backend refactor 38

Changed:
- `src/lib/learning/types.ts`: clarified `isSkill` narrowing through a local readonly alias without changing exported `SKILLS`/`Skill` contracts.
- `src/app/api/classrooms/[id]/analytics/route.ts`: extracted response/error strings and analytics access predicate; preserved RBAC and response shape.
- `src/app/manifest.ts`: extracted manifest color/icon builders; preserved manifest output.
- `src/app/api/assignments/[id]/completion/route.ts`: extracted completion input shaping; preserved status/body behavior.
- `src/app/api/admin/articles/[id]/review/route.ts`: removed unused type import and extracted audit metadata/response payload helpers; preserved audit privacy and response shape.
- `src/app/admin/layout.tsx`: extracted admin layout props and shell-user mapping; preserved layout behavior.

Skipped:
- `src/lib/jobs/types.ts`: clean shared type/status contract; no safe behavior-preserving refactor needed.
- `src/lib/learning/index.ts`: clean public barrel/export contract; no safe behavior-preserving refactor needed.

Validation:
- `npx eslint src/lib/learning/types.ts 'src/app/api/classrooms/[id]/analytics/route.ts' src/app/manifest.ts 'src/app/api/assignments/[id]/completion/route.ts' 'src/app/api/admin/articles/[id]/review/route.ts' src/app/admin/layout.tsx` passed.
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/classroom-routes.test.ts tests/content-routes.test.ts` passed (30 tests).
- `git --no-pager diff --check` passed.

# Tank service refactor 39

- Changed: `src/lib/article-library/collections/default-list-policy.ts`, `src/lib/ai/evals/evaluators/quiz.ts`, `src/lib/ai/evals/evaluators/grammar.ts`, `src/lib/metrics/recorders/cache.ts`, `src/lib/runtime-config/database.ts`, `src/lib/translate-lang.ts`.
- Skipped: `src/lib/admin/tags.ts`, `src/lib/account-lifecycle/index.ts` because both are clean public barrels.
- Validation: targeted ESLint passed; targeted tests passed (`tests/bookmarks.test.ts`, `tests/shared-validation-pure.test.ts`, `tests/metrics.test.ts`, `tests/ready-route.test.ts`); `git --no-pager diff --check` passed.

# Trinity UI refactor 39

Refactored the eight requested clean target files with behavior-preserving local helpers/type cleanup only:

- `src/app/(app)/progress/_sections/FluencySection.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/onboarding/steps/StepAbout.tsx`
- `src/components/SkeletonCard.tsx`
- `src/components/teacher/AssignArticleForm.tsx`
- `src/components/ArticleStudySection.tsx`
- `src/components/reader/usePronunciationPersistence.ts`
- `src/components/lists/ListDeleteControl.tsx`

Skipped: none of the requested target files had pre-existing staged/unstaged changes at start.

Validation:
- `npx --no-install eslint ...target files...` passed.
- Focused tests passed: `tests/fluency-trend.test.ts`, `tests/pronunciation-routes.test.ts`, `tests/classroom-routes.test.ts`, `tests/list-name-validation.test.ts`.
- IDE diagnostics for changed files were empty.
- `git --no-pager diff --check` passed.

# Mouse backend refactor 39

- Refactored only the requested eight route files with local helpers/constants/type guards.
- Skipped files: none.
- Preserved route response shapes, statuses, auth/visibility checks, audit metadata, and cache invalidation behavior.
- Validation: targeted eslint passed; nearest route tests passed; typecheck passed; git diff --check passed.

# Tank libraries refactor 40

Refactored three safe utility/prompt files only:
- `src/lib/ai/prompts/sentence-translation.ts`: extracted local constants and prompt-render helper without changing prompt semantics or sanitization.
- `src/lib/db-utils.ts`: extracted PostgreSQL URL prefix list/helper without changing environment behavior.
- `src/lib/list-name-validation.ts`: extracted validation error helpers without changing returned messages.

Skipped clean barrels/re-export contracts:
- `src/lib/ai/output/index.ts`
- `src/features/profile-preferences/values.ts`
- `src/lib/processing/index.ts`
- `src/lib/tutor.ts`
- `src/features/profile-preferences/index.ts`

Validation passed:
- `npx eslint src/lib/ai/prompts/sentence-translation.ts src/lib/db-utils.ts src/lib/list-name-validation.ts`
- `NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/list-name-validation.test.ts tests/prompts.test.ts`
- `git --no-pager diff --check`

# Trinity UI Refactor 40

- Refactored the requested eight UI/frontend files only.
- Preserved behavior while extracting local helpers/constants and using the existing Stack primitive on the progress page.
- Validation passed: targeted ESLint and `git --no-pager diff --check`.
- No obvious nearest tests existed for these component-only changes.

# Mouse routes refactor 40

Changed: `src/app/api/saved/route.ts`, `src/app/api/reader/[id]/translate-sentence/route.ts`, `src/app/api/progress/batch/route.ts`, `src/app/api/reader/[id]/translate/route.ts`, `src/app/api/lists/[id]/items/[articleId]/route.ts`, `src/app/api/bookmarks/membership/route.ts`, `src/app/api/account/route.ts`.

Skipped: `src/app/api/quiz/mastery/route.ts` (already minimal; no safe behavior-preserving extraction worth making).

Validation: targeted ESLint passed; targeted route tests passed (90 tests); `git --no-pager diff --check` passed.

### 2026-07-03T08-00-05: Batch 41 config/scripts refactor scope
**By:** Tank
**What:** Batch 41 config/scripts refactor scope
**References:** tank-batch-41
**Why:** Completed behavior-preserving local-helper refactors only in owned config/script files for batch forty-one. Skipped next.config.ts because it was already cohesive and no safe meaningful refactor stood out without churn. Validation found an existing api-catalog drift test failure unrelated to these refactors; targeted ESLint, typecheck, API catalog dry-run, and diff whitespace checks passed.

### 2026-07-03T08-00-12: Batch 41 kept route-state refactors local to owned UI files
**By:** Trinity
**What:** Batch 41 kept route-state refactors local to owned UI files
**References:** trinity-batch-41
**Why:** Refactored owned route-state and dashboard/import UI files by extracting local config objects, typed route-state props, skeleton subcomponents, and small mapping helpers. Chose local helpers only, preserving rendered copy, routes, component contracts, focus semantics, and design-system token usage without shared abstractions or dependency changes.

### 2026-07-03T08-00-15: Batch 41 route refactor scope
**By:** Mouse
**What:** Batch 41 route refactor scope
**References:** mouse-batch-41, src/app/api/admin/jobs/route.ts, src/app/api/admin/metrics/route.ts, src/app/api/admin/slo/route.ts, src/app/api/admin/sources/route.ts, src/app/api/admin/tags/[id]/route.ts
**Why:** For batch forty-one, I kept changes limited to API route handlers where a safe local helper extraction reduced inline route logic without changing behavior. Touched jobs, metrics, slo, sources, and admin tag id routes; skipped analytics, articles, stats, and tags index because their handlers are already thin single-call wrappers and any local extraction would be churn rather than meaningful behavior-preserving cleanup.

### 2026-07-03T08-05-42: Batch 42 scripts/config refactor completed
**By:** Tank
**What:** Batch 42 scripts/config refactor completed
**References:** tank-batch-42, next.config.ts, scripts/generate-wordfreq-ranks.ts, scripts/seed.ts, scripts/train-quality-classifier.ts
**Why:** Behavior-preserving refactor only in owned files: extracted standalone output config in next.config.ts; named word-frequency rendering constants and output renderer; split seed argument validation, optional-provider warnings, and options building; extracted classifier training/output path helpers. No generated/data rewrites or dependency changes. Validation passed: targeted ESLint, git diff --check, and seed --help smoke test.

### 2026-07-03T08-06-05: Batch 42 API route refactor kept behavior-preserving helper extraction scoped to five owned handlers
**By:** Mouse
**What:** Batch 42 API route refactor kept behavior-preserving helper extraction scoped to five owned handlers
**References:** mouse-batch-42, src/app/api/classrooms/[id]/assignments/route.ts, src/app/api/coach-memory/route.ts, src/app/api/health/route.ts, src/app/api/lists/[id]/items/route.ts, src/app/api/lists/route.ts
**Why:** Refactored only safe API route handlers from the owned list. Extracted article existence and due-date parsing helpers in classroom assignments, response helpers/constants in health, coach-memory, lists item, and lists collection handlers, and removed an unused ApiError import from lists route. Skipped trivial admin analytics/articles/stats/tags, NextAuth, and bookmark toggle handlers because no meaningful local refactor was safer than leaving their already-minimal implementations unchanged. Validation passed: targeted ESLint on touched routes, targeted route tests for bookmarks/lists/classrooms/coach-memory, and git diff --check.

### 2026-07-03T08-06-05: Batch 42 progress/reader/page UI refactor scope
**By:** Trinity
**What:** Batch 42 progress/reader/page UI refactor scope
**References:** trinity-batch-42, src/app/(app)/progress/_sections/LevelDistributionSection.tsx, src/app/(app)/reader/[id]/loading.tsx
**Why:** For batch 42, I kept refactors behavior-preserving and limited to owned progress/reader/page UI files. I extracted local constants for repeated skeleton counts/actions and chart metadata, and moved LevelDistributionSection max-count calculation out of its render loop. I skipped already-minimal route shells and simple section wrappers where helper extraction would add indirection without reducing duplication.

### 2026-07-03T08-09-22: Batch 43 API route refactors stay local and behavior-preserving
**By:** Mouse
**What:** Batch 43 API route refactors stay local and behavior-preserving
**References:** mouse-batch-43, src/app/api/push/subscribe/route.ts, src/app/api/today/reflection/route.ts
**Why:** Refactored only owned API route files with local clarity helpers/aliases: pushed endpoint URL validation into a helper, reused resolved user/article identifiers, and isolated Today reflection feature-gate logic. Skipped tiny routes where a safe meaningful refactor would add indirection without improving maintainability. No route contracts, auth, status codes, provider fallback behavior, cache invalidation, or database side effects were intentionally changed.

### 2026-07-03T08-10-05: Batch 43 app-page refactors stayed local and behavior-preserving
**By:** Trinity
**What:** Batch 43 app-page refactors stayed local and behavior-preserving
**References:** trinity-batch-43, src/app/(app)/series/SeriesEnrollButton.tsx, src/app/(app)/settings/RetakePlacement.tsx, src/app/(app)/study/loading.tsx, src/app/(app)/tags/page.tsx, src/app/(app)/welcome/WelcomePlacement.tsx, src/app/(app)/welcome/page.tsx, src/app/admin/loading.tsx, src/app/onboarding/page.tsx, src/app/onboarding/steps/StepTopics.tsx, src/app/page.tsx, src/app/providers.tsx, src/app/sitemap.ts
**Why:** Refactored only owned app page and route-state files by extracting local helpers/constants/prop types for enrollment requests, placement callbacks/state, loading skeleton repetition, tag rendering, onboarding defaults, landing CTA action, providers props, and sitemap route assembly. Skipped tiny/error/not-found route-state files where extraction would add indirection without maintainability value. Validation passed with targeted ESLint, git diff --check, and full TypeScript typecheck.

### 2026-07-03T08-11-05: Batch 43 shared-components refactor scoped to owned files
**By:** Switch
**What:** Batch 43 shared-components refactor scoped to owned files
**References:** switch-batch-43, src/components, src/components/admin
**Why:** Completed behavior-preserving shared component refactors for batch 43. Extracted local helpers/props/types and deduplicated repeated fragments in owned shared/admin components while preserving props, text, styling tokens, focus semantics, side effects, and exports. Skipped SettingsThemeRow because it already had clear local options and handlers and no safe meaningful refactor was found. Validation passed: targeted ESLint for touched files, npm run typecheck, and git diff --check for owned files.

### 2026-07-03T08-12-36: Batch forty-three review approved
**By:** Morpheus
**What:** Batch forty-three review approved
**References:** batch-43, huangyingting
**Why:** Reviewed only the batch forty-three file set. The changes are scoped refactors (constant/helper/type extraction) preserving route auth/status/response/cache behavior, push subscription validation, reader quiz/speech/tags persistence, onboarding/settings/landing/provider/sitemap semantics, shared component behavior, admin components, and type safety. IDE diagnostics returned no issues. Verdict: APPROVED.

### 2026-07-03T08-14-26: Batch 44 minimal route refactor classification
**By:** Mouse
**What:** Batch 44 minimal route refactor classification
**References:** mouse-batch-44, src/app/api/auth/[...nextauth]/route.ts
**Why:** Revisited the ten owned minimal API route handlers for batch 44. Applied behavior-preserving helper extractions in nine files to isolate response/input assembly while keeping auth wrappers, status codes, JSON shapes, logging, and provider fallback behavior unchanged. Classified src/app/api/auth/[...nextauth]/route.ts as no-op/minimal because it already only creates and re-exports the NextAuth handler; any refactor would add indirection without a safer route boundary. Validation passed with targeted ESLint, targeted route tests, IDE diagnostics, and git diff whitespace check.

### 2026-07-03T08-15-10: Batch 44 reader/shared refactors kept behavior-preserving and owned-file scoped
**By:** Switch
**What:** Batch 44 reader/shared refactors kept behavior-preserving and owned-file scoped
**References:** switch-batch-44, src/components/reader/useActiveWord.ts, src/components/reader/highlightsReducer.ts, src/components/reader/wordLookup/useDictionaryLookup.ts
**Why:** Completed batch forty-four by limiting edits to the assigned owned files and using only structural refactors: extracted repeated class/id constants, endpoint/message constants, small pure helpers for reader/flashcard hooks, and selector/storage helpers. Skipped owned barrel/type/simple component files where changes would be cosmetic or risk altering public exports/contracts. Validation passed with targeted ESLint, targeted command-navigation/highlights reducer tests, and git diff whitespace check.

### 2026-07-03T08-16-13: Batch 44 UI refactor kept behavior-preserving extraction only
**By:** Trinity
**What:** Batch 44 UI refactor kept behavior-preserving extraction only
**References:** src/components/marketing/*, src/components/pronunciation/*, src/app route-state files
**Why:** For batch forty-four, I limited changes to the owned marketing, pronunciation, analytics, legal, and route-state UI files. Refactors extracted repeated literals, small predicates, delay calculations, and stable action/copy constants while preserving component props/contracts, rendered copy, design-token usage, focus/keyboard behavior, animation timings, and public exports. I skipped files where only route wrappers were already minimal or where further abstraction would risk changing semantics. Validation completed with ESLint and git diff whitespace checks.

### 2026-07-03T08-21-42: Batch 45 refactor scope limited to small type/catalog helpers
**By:** Tank
**What:** Batch 45 refactor scope limited to small type/catalog helpers
**References:** tank-batch-45, src/lib/analytics/events/catalog.ts, src/lib/ai/provider.ts, src/lib/ai/prompts/types.ts, src/lib/ai/prompts/index.ts
**Why:** For the batch forty-five owned library/barrel pass, I only changed files with safe type/catalog consolidation opportunities: analytics event catalog now uses a typed catalog helper, AI provider literal unions are named aliases, and article-source prompt vars share one alias re-exported through the prompts barrel. Pure barrels and tiny documentation/type-only modules with no meaningful behavior-preserving refactor were intentionally skipped to avoid churn. Validation passed with targeted ESLint, focused prompt/AI/analytics tests, IDE diagnostics for touched files, and git diff check.

### 2026-07-03T08-23-15: Batch 45 refactor scope kept behavior-preserving and skipped pure barrels
**By:** Switch
**What:** Batch 45 refactor scope kept behavior-preserving and skipped pure barrels
**References:** switch-batch-45, src/components/route-states/SegmentNotFound.tsx, src/components/shell/AppFooter.tsx, src/components/shell/AppHeader.tsx, src/components/shell/AppShell.tsx, src/components/shell/HeaderShell.tsx, src/components/teacher/AddStudentForm.tsx, src/components/teacher/CompleteAssignmentButton.tsx, src/components/teacher/CreateOrgForm.tsx, src/components/tutor/useAutoGrowingTextarea.ts, src/components/ui/FormActions.tsx, src/components/ui/Skeleton.tsx, src/components/ui/Spinner.tsx, src/components/ui/TableSurface.tsx, src/components/vocabulary/JournalPagination.tsx
**Why:** Refactored only owned implementation files by extracting local constants, prop interfaces, endpoint/size helpers, and simple derived booleans while preserving existing props, rendered text, token classes, routes, payload shapes, focus semantics, and public exports. Pure barrel/type-only files were intentionally left unchanged because no safe meaningful behavior-preserving refactor existed. Validation completed with targeted lint command and diff whitespace check; no obvious component tests referenced the touched components/hooks in tests/.

### 2026-07-03T08-23-50: Batch 45 refactor scoped to safe local helper extraction and design-token reuse
**By:** Trinity
**What:** Batch 45 refactor scoped to safe local helper extraction and design-token reuse
**References:** trinity-batch-45, src/features/profile-preferences/TopicSelector.tsx, src/hooks/useAdminAction.ts, src/hooks/useMediaQuery.ts, src/lib/format-relative.ts, src/lib/safe-json.ts
**Why:** Refactored only owned files with behavior-preserving changes: TopicSelector now reuses the shared focusRing primitive and uses a Set for selected-topic lookup; useAdminAction names its options shape; useMediaQuery extracts the matchMedia capability guard while preserving SSR-first false behavior and listener lifecycle; format-relative extracts duration constants; safe-json consolidates JSON escaping through one unsafe-character regex and switch mapper. Clean barrels/runtime constants/instrumentation were intentionally left unchanged where refactoring would add noise or risk Next.js runtime tree-shaking semantics.

### 2026-07-03T08-29-12: Batch 46 refactor classification: two safe client/UI refactors, remaining owned small files no-op
**By:** Switch
**What:** Batch 46 refactor classification: two safe client/UI refactors, remaining owned small files no-op
**References:** switch-batch-46, src/components/SettingsThemeRow.tsx, src/components/command/useCommandPaletteDialog.ts
**Why:** Reviewed the owned Batch 46 files only. Applied behavior-preserving refactors to src/components/SettingsThemeRow.tsx by naming the default theme and displayed copy once, and to src/components/command/useCommandPaletteDialog.ts by extracting body-scroll lock and dialog restore helpers while preserving mount-only focus/scroll/focus-restore behavior. Classified the rest as no-op because they are pure barrels, type-only/re-export files, minimal Next route/not-found/script wrappers, or already minimal instrumentation where additional churn would not improve maintainability safely. Validation passed: npx eslint src/components/SettingsThemeRow.tsx src/components/command/useCommandPaletteDialog.ts; NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/theme-runtime.test.ts; git --no-pager diff --check against the owned file set.

### 2026-07-03T08-29-15: Batch 46 domain library refactor classification
**By:** Tank
**What:** Batch 46 domain library refactor classification
**References:** tank-batch-46, src/lib/copy/pages.ts, src/lib/jobs/types.ts
**Why:** Reviewed owned domain-library files for behavior-preserving refactor opportunities. Most owned files are pure barrels or tiny type-only modules, so they were intentionally left as no-op to avoid export churn. Applied only two safe refactors: centralized repeated page-title suffix formatting in src/lib/copy/pages.ts while preserving exact strings, and named the job lock TTL units in src/lib/jobs/types.ts while preserving DEFAULT_LOCK_TTL_MS = 600000. Validation passed: targeted ESLint for touched files, tests/legal-content.test.ts, tests/jobs.test.ts, and git diff --check for touched files.

### 2026-07-03T08-30-26: Batch 46 platform/runtime refactor classification
**By:** Mouse
**What:** Batch 46 platform/runtime refactor classification
**References:** TASK: Batch forty-six behavior-preserving refactor/no-op classification for platform/runtime library modules
**Why:** Classified the owned platform/runtime library files for this batch. Most files were pure barrels, empty placeholders, or tiny type-only/re-export modules, so they were intentionally left as no-op to avoid churn and preserve public exports/module boundaries. The only meaningful behavior-preserving refactor was in src/lib/scraper/providers/index.ts: extracted URL hostname normalization and provider host matching helpers used by providerForUrl while preserving provider ordering, fallback behavior, and matching semantics. Validation passed with targeted ESLint, focused provider tests, and git diff whitespace check.

### 2026-07-03T08-41-41: Batch 47 refactor limited to shared route-test helpers
**By:** Mouse
**What:** Batch 47 refactor limited to shared route-test helpers
**References:** mouse-batch-47, tests/account.test.ts, tests/admin-analytics-routes.test.ts, tests/admin-jobs-routes.test.ts, tests/audit-routes.test.ts, tests/bookmarks-routes.test.ts, tests/content-routes.test.ts
**Why:** Refactored only owned admin/account/API route tests by replacing local request/params/JSON helpers with existing tests/support/route helpers. Behavior, assertions, mocks, fixtures, and route contracts were preserved. No production code, API catalog files, branches, commits, resets, or unrelated working-tree files were touched. Validation passed: targeted node tests for touched files, targeted ESLint for touched files, and git --no-pager diff --check.

### 2026-07-03T08-42-09: Batch 47 test refactor kept to AI/cache/moderation owned tests
**By:** Tank
**What:** Batch 47 test refactor kept to AI/cache/moderation owned tests
**References:** tank-batch-47, tests/ai-article-cache.test.ts, tests/ai-cache-selection.test.ts, tests/ai-chunking.test.ts, tests/ai-eval-live-default.test.ts, tests/ai-eval.test.ts, tests/ai-input-safety.test.ts, tests/ai-moderation.test.ts, tests/ai-provider.test.ts, tests/ai-runner.test.ts, tests/prompt-injection-evals.test.ts, tests/sentence-translation-routes.test.ts, tests/sentence-translation.test.ts
**Why:** Refactored only owned AI/cache/moderation-related test files by extracting local helpers for cache imports, fixture builders, token/sentence assertions, moderation cases, provider/runner error responses, prompt-injection failure collection, and sentence-translation route/fixture setup. Preserved behavior and validated the touched tests with the targeted node test runner, targeted ESLint, and git diff --check.

### 2026-07-03T08-45-36: Batch 47 test refactor scoped to owned UI/e2e files
**By:** Trinity
**What:** Batch 47 test refactor scoped to owned UI/e2e files
**References:** trinity-batch-47, e2e/accessibility.spec.ts, tests/roving-tabindex.test.ts
**Why:** Refactored only the 20 owned e2e/UI/hook test files by extracting local sign-in/navigation/page helpers, table-driven assertion helpers, shared type aliases, and module import setup. Preserved existing assertions, route expectations, fixtures, setup/teardown, and failure semantics. Targeted node tests and eslint passed; targeted TypeScript check via a temporary project config still reports existing NextAuth session typing errors in src/lib/api-handler.ts, src/lib/auth-core.ts, and src/lib/auth.ts, with no remaining diagnostics from the touched files after fixing the command-items readonly fixture issue. Playwright was not run because this shared environment would start the configured Next dev server and run Prisma migrations against the e2e database.

### 2026-07-03T08-47-33: Batch 47 AI test typecheck fix
**By:** Tank
**What:** Batch 47 AI test typecheck fix
**References:** tests/ai-moderation.test.ts, tests/ai-provider.test.ts, tests/ai-runner.test.ts
**Why:** Fixed Tank-owned AI test type regressions by naming the optional moderation safeProbe shape and using AiProviderError for helper parameters instead of indexing the AiChatResponse union. This preserves assertions and avoids broad casts or production changes.

### 2026-07-03T08-54-10: Batch 48 test refactor kept to local helpers in owned test files
**By:** Switch
**What:** Batch 48 test refactor kept to local helpers in owned test files
**References:** switch-batch-48, tests/azure-storage.test.ts, tests/backoff.test.ts, tests/batch-synthesis.test.ts, tests/config.test.ts, tests/discovery-ranking.test.ts, tests/feature-flags.test.ts, tests/jobs.test.ts, tests/logger.test.ts, tests/media-blob.test.ts
**Why:** Refactored only owned platform/storage/scraper/infra tests by extracting local helper functions and constants for repeated storage imports/env setup, deterministic backoff fixtures, date fixture creation, log parsing, media blob imports/reset, feature-flag fetch spying, batch synthesis pass results, config warning/error code checks, and job relative timestamps. No assertions, fixtures, mocks, failure semantics, production code, or dependencies were changed. Targeted node tests, targeted ESLint, and git diff whitespace checks passed.

### 2026-07-03T08-55-22: Batch 48 test refactor scoped to analytics/article/classroom/learning tests
**By:** Tank
**What:** Batch 48 test refactor scoped to analytics/article/classroom/learning tests
**References:** tank-batch-48, tests/analytics.test.ts, tests/article-access.test.ts, tests/article-mastery.test.ts, tests/classroom-progress.test.ts, tests/classroom-queries.test.ts, tests/classroom-student-reads.test.ts, tests/difficulty-feedback-route.test.ts, tests/fluency-analytics-privacy.test.ts, tests/goal-path-privacy.test.ts
**Why:** Refactored only owned domain test files by extracting local module import helpers, fixture builders, typed last-args accessors, JSON response helpers, and privacy assertion helpers. Preserved assertion semantics, mocks, setup/teardown, and coverage intent; skipped remaining owned files where a safe meaningful local refactor was not necessary for this batch. Validation passed with targeted ESLint, targeted node tests for touched files, and git diff whitespace check.

### 2026-07-03T08-55-45: Batch 48 test refactor kept route/admin/auth/content tests behavior-preserving
**By:** Mouse
**What:** Batch 48 test refactor kept route/admin/auth/content tests behavior-preserving
**References:** mouse-batch-48, tests/admin-jobs.test.ts, tests/api-handler.test.ts, tests/content-policy.test.ts
**Why:** Refactored only owned test files by extracting local import/env/fixture/status helpers and small parameterized validation cases. Touched tests/admin-jobs.test.ts, tests/admin-member-commands.test.ts, tests/admin-member-detail.test.ts, tests/admin-members.test.ts, tests/api-handler.test.ts, tests/auth-core.test.ts, tests/auth-providers.test.ts, tests/content-policy.test.ts, tests/feed-route.test.ts, tests/profile-route.test.ts, and tests/reading-time-route.test.ts. No production code, dependencies, or git state changes were made. Validation passed with targeted node test command, targeted ESLint, and git diff --check.

### 2026-07-03T08-57-07: Fix batch 48 admin jobs test status helper typing
**By:** Mouse
**What:** Fix batch 48 admin jobs test status helper typing
**References:** batch-48, tests/admin-jobs.test.ts
**Why:** In tests/admin-jobs.test.ts, keep the stub job type as an explicit alias using Prisma JobStatus and JobType instead of deriving it from the currently-null stubJob variable. This preserves the action guard assertions while avoiding the control-flow-narrowed NonNullable<typeof stubJob> => never regression reported by typecheck.

### 2026-07-03T09-00-38: Batch 49 AI/util test refactor classifications
**By:** Tank
**What:** Batch 49 AI/util test refactor classifications
**References:** tank-batch-49, tests/translation.test.ts, tests/result.test.ts, tests/safe-json.test.ts
**Why:** Touched tests/translation.test.ts, tests/result.test.ts, and tests/safe-json.test.ts with behavior-preserving local helper extraction to remove duplicated fixture/assertion setup while keeping assertions and failure semantics intact. Classified the remaining owned files as no-op after review because existing tests were already concise or helper extraction would add indirection without improving clarity: tests/ai-budget-shared-store.test.ts, tests/ai-facade.test.ts, tests/ai-ledger-cache.test.ts, tests/ai-validation.test.ts, tests/ai.test.ts, tests/prompts.test.ts, tests/sentence-translation-guards.test.ts, tests/format-relative.test.ts, tests/list-name-validation.test.ts, tests/validation.test.ts, tests/ts-resolve-hook.test.ts, tests/ui-cn.test.ts. Validation passed: targeted node test command for touched files, targeted ESLint for touched files, and git --no-pager diff --check.

### 2026-07-03T09-01-29: Batch 49 test refactors preserved behavior in learning/offline/domain tests
**By:** Switch
**What:** Batch 49 test refactors preserved behavior in learning/offline/domain tests
**References:** switch-batch-49, tests/bilingual.test.ts, tests/cloze.test.ts, tests/offline-sync.test.ts, tests/practice-attempts.test.ts, tests/quiz-grading.test.ts
**Why:** Refactored only owned test files: tests/bilingual.test.ts now imports pure helpers once; tests/cloze.test.ts, tests/practice-attempts.test.ts, tests/quiz-grading.test.ts, and tests/offline-sync.test.ts use local assertion helpers/table-driven cases to reduce duplication without weakening assertions. Validation passed with targeted node tests, targeted ESLint, and git diff whitespace check. No production code, dependencies, git branches, or commits changed.

### 2026-07-03T09-01-50: Batch 49 refactored selected admin/auth/content route tests without contract changes
**By:** Mouse
**What:** Batch 49 refactored selected admin/auth/content route tests without contract changes
**References:** tests/auth-bootstrap.test.ts, tests/coach-memory-route.test.ts, tests/assets.test.ts, tests/api-catalog-drift.test.ts, tests/api-catalog-generation.test.ts, tests/ready-route.test.ts, tests/profile.test.ts
**Why:** Refactored only owned test files with behavior-preserving local helpers/constants: centralized auth-bootstrap import helper, coach-memory DELETE response helper, asset existence helper/import cleanup, committed API catalog reader helper, API catalog route lookup helper, ready-route env/response helpers, and dailyGoal assertion helper. Targeted tests including api-catalog-drift still fail on pre-existing catalog drift unrelated to these refactors; the same touched subset excluding drift passes. ESLint and diff whitespace checks passed.

### 2026-07-03T09-05-44: Batch 50 miscellaneous test refactor classification
**By:** Tank
**What:** Batch 50 miscellaneous test refactor classification
**References:** tank-batch-50, tests/client-fetch.test.ts, tests/http-provider-client.test.ts, tests/lexical-provider.test.ts, tests/listing-load-more.test.ts, tests/metrics-registry.test.ts, tests/observability.test.ts, tests/robots.test.ts
**Why:** Behavior-preserving refactor pass for the remaining miscellaneous owned tests. Refactored seven tests with local helpers/shared setup only: client-fetch JSON request assertions, http-provider fetch stub setup, lexical local dictionary scratch directory in repo-local artifacts, listing-load-more id projection, metrics-registry bucket lookup, observability barrel import helper, and robots dependency helper. Classified all other owned files as no-op because no safe meaningful clarity refactor was apparent without risking assertion/setup semantics. Validation passed: targeted node test command for touched files (70 tests), targeted ESLint for touched files, and git diff --check.

### 2026-07-03T09-07-10: Batch 50 test refactor kept scraper/security/storage/platform behavior unchanged
**By:** Switch
**What:** Batch 50 test refactor kept scraper/security/storage/platform behavior unchanged
**References:** switch-batch-50, tests/bbc-rss.test.ts, tests/nautilus-wp.test.ts, tests/scraper-extractor.test.ts, tests/security-events.test.ts, tests/ssrf.test.ts, tests/storage-azure-provider.test.ts, tests/storage-config.test.ts, tests/storage-contract.test.ts, tests/storage-worker-runtime.test.ts
**Why:** Refactored only owned test files with local helpers for provider lookup, URL assertions, discovery dependencies, SSRF address privacy checks, security event restore/find utilities, Azure storage construction, storage contract speech puts, storage config assertions, and E2E DB guard assertions. Preserved assertions, mocks, fixtures, and isolation; skipped owned files where no safe clarity-only refactor was needed. Validation passed with targeted node tests for touched files, targeted ESLint, and git diff --check.

### 2026-07-03T09-07-21: Batch 50 test refactors kept local and behavior-preserving
**By:** Mouse
**What:** Batch 50 test refactors kept local and behavior-preserving
**References:** tests/series-access.test.ts, tests/series-today-candidate.test.ts, tests/speech-audio-route.test.ts, tests/speech-provider-azure.test.ts, tests/srs.test.ts, tests/today-session-target-words.test.ts, tests/today-set-article-route.test.ts, tests/today-set-article.test.ts, tests/tutor-routes.test.ts, tests/vocabulary.test.ts, tests/word-mastery.test.ts
**Why:** Refactored only owned test files by extracting local fixture/import/request helpers in series, speech, today, tutor, SRS, vocabulary, and word-mastery tests. Preserved existing assertions, mocked providers, privacy checks, response/status checks, and failure semantics. Validation passed with targeted node tests for touched files, targeted ESLint, and git diff --check. No production code, dependencies, commits, branches, resets, checkouts, or reverts were used.

### 2026-07-03T09-15-07: Batch 51 final test-refactor pass completed for listed AI/analytics/article/general tests
**By:** Tank
**What:** Batch 51 final test-refactor pass completed for listed AI/analytics/article/general tests
**References:** Tank, ReadWise tests batch 51
**Why:** Reviewed the owned batch as listed in the request (49 paths were enumerated despite the task title saying fifty-one). Behavior-preserving refactors applied only to tests/e2e-seed-guard.test.ts and tests/heatmap.test.ts: extracted local assertion helpers for e2e database guard cases; consolidated heatLevel boundary cases into a same-name table loop and reused a TEST_TODAY/emptyActivityMap helper. No assertions, fixtures, mocks, setup/teardown, env cleanup, or production code were changed.

No-op/minimal classifications for the remaining owned paths: tests/admin-ai-ops.test.ts, tests/admin-article-read-models.test.ts, tests/aggregation.test.ts, tests/ai-budget-shared-store.test.ts, tests/ai-facade.test.ts, tests/ai-ledger-cache.test.ts, tests/ai-validation.test.ts, tests/ai.test.ts, tests/analytics-queries.test.ts, tests/article-review-workflow.test.ts, tests/article-visibility-regressions.test.ts, tests/articles.test.ts, tests/audit.test.ts, tests/backfill.test.ts, tests/cache-version.test.ts, tests/categories.test.ts, tests/classroom.test.ts, tests/client-ip.test.ts, tests/content-pipeline.test.ts, tests/content-review.test.ts, tests/csrf.test.ts, tests/db-schema.test.ts, tests/dictation.test.ts, tests/dictionary.test.ts, tests/difficulty-ai-assessment.test.ts, tests/discovery-default-fetch.test.ts, tests/engagement-time.test.ts, tests/error-reporting.test.ts, tests/fixtures/coverage-gate/native-pass.fixture.ts, tests/fixtures/prompt-injection-cases.ts, tests/fluency-trend.test.ts, tests/format-relative.test.ts, tests/frequency.test.ts, tests/goal-path.test.ts, tests/grammar.test.ts, tests/heatmap-repo.test.ts, tests/helpers.ts, tests/i18n-catalog.test.ts, tests/import-url.test.ts, tests/job-worker.test.ts, tests/legal-content.test.ts, tests/level-timeline.test.ts, tests/leveling-adaptive.test.ts, tests/leveling.test.ts, tests/lexical-normalize.test.ts, tests/list-name-validation.test.ts, tests/listing-cache.test.ts. Rationale: current coverage intent and local structure are already clear enough; further edits would mostly churn mocks/fixtures or risk weakening explicit behavior documentation.

Validation passed: NODE_ENV=test node --env-file-if-exists=.env --experimental-strip-types --import ./scripts/register-ts.mjs --no-warnings --experimental-test-module-mocks --test tests/heatmap.test.ts tests/e2e-seed-guard.test.ts (21 passing); npx eslint tests/heatmap.test.ts tests/e2e-seed-guard.test.ts; git --no-pager diff --check.

### 2026-07-03T09-15-10: Batch 51 final-pass test refactor classifications
**By:** Switch
**What:** Batch 51 final-pass test refactor classifications
**References:** switch-batch-51, tests/speech-json.test.ts, tests/today-session-types.test.ts
**Why:** Reviewed the 51 owned scraper/search/speech/today/UI test files for behavior-preserving final-pass opportunities. Applied clarity-only helper extraction in tests/speech-json.test.ts (shared rejection assertions for malformed speech timing payloads) and tests/today-session-types.test.ts (shared accepted/rejected controlled-value validator assertions). Classified all other owned files as no-op/minimal for this pass because their current setup, mocks, assertions, and cleanup are already local and explicit; further changes would risk weakening failure semantics or over-abstracting small targeted tests. Validated touched files with the exact node test command, targeted ESLint, and git diff --check.

### 2026-07-03T09-15-27: Batch 51 platform/route/domain test refactor classification
**By:** Mouse
**What:** Batch 51 platform/route/domain test refactor classification
**References:** Mouse batch 51, tests/metrics-exporter.test.ts, tests/org-routes.test.ts, tests/processing-state.test.ts, tests/push-routes.test.ts
**Why:** Reviewed the 50 listed remaining platform/route/domain test files for final behavior-preserving cleanup. Applied safe clarity-only refactors to four owned files: data-driven Prometheus label escaping cases in tests/metrics-exporter.test.ts; shared org member POST helper in tests/org-routes.test.ts; non-null upsert assertion helper in tests/processing-state.test.ts; shared push route dynamic import helpers in tests/push-routes.test.ts. Classified all other listed owned files as no-op/minimal because their existing local setup, assertions, and fixtures were already concise or any further helper extraction risked weakening test intent without meaningful clarity gain. Validation passed: targeted node test command for the four touched files, targeted ESLint for the same files, and git diff --check for the same files.

### 2026-07-03T09-16-57: Fix batch 51 speech JSON test helper type regression
**By:** Switch
**What:** Fix batch 51 speech JSON test helper type regression
**References:** tests/speech-json.test.ts, batch-51, typecheck-regression
**Why:** Updated tests/speech-json.test.ts helper parameters from unknown to Prisma.JsonValue | null | undefined, matching parseStoredSpeechWords and parseStoredSpeechTimingPayload inputs. This preserves rejection assertions while proving malformed JSON-shaped payloads are passed through the real parser contract instead of weakening with broad casts or production changes.

### 2026-07-03T09-21-03: Update query-index sentinel for helper extraction
**By:** Switch
**What:** Update query-index sentinel for helper extraction
**References:** tests/query-indexes.test.ts, src/lib/article-library/policy.ts
**Why:** Adjusted tests/query-indexes.test.ts so the public feed predicate sentinel verifies publicListableArticleWhere delegates to publicListableAccessWhere and that the helper requires ownerId: null. This preserves ownerless partial-index policy coverage without depending on ownerId appearing directly in the exported function's short source window.

### 2026-07-03T09-23-22: Refreshed generated API catalog docs
**By:** Mouse
**What:** Refreshed generated API catalog docs
**References:** docs/platform/api-catalog.json, docs/platform/api-catalog.md, tests/api-catalog-drift.test.ts
**Why:** Ran the repository API catalog generator after the drift test reported stale committed catalog docs. The generator updated only docs/platform/api-catalog.json and docs/platform/api-catalog.md. Validated with the targeted catalog drift test and git diff whitespace check; skipped typecheck because only generated Markdown/JSON docs changed and no TypeScript/source files were edited.

### 2026-07-03T09-54-23: API catalog resolves local helper response contracts
**By:** Mouse
**What:** API catalog resolves local helper response contracts
**References:** scripts/generate-api-catalog.ts, src/tools/api-catalog.ts, docs/platform/api-catalog.json, docs/platform/api-catalog.md
**Why:** Updated the API catalog generator to keep route contracts accurate after behavior-preserving helper/constant extraction. The generator now follows simple local response/query helpers, resolves numeric status constants and response-init constants, ignores non-2xx error responses when choosing success contracts, and classifies JSON attachment responses without requiring route refactors. Regenerated docs/platform/api-catalog.json and docs/platform/api-catalog.md from the improved generator.

### 2026-07-03T10-00-50: API catalog now follows inline query helper calls
**By:** Mouse
**What:** API catalog now follows inline query helper calls
**References:** src/tools/api-catalog.ts, tests/api-catalog-generation.test.ts, docs/platform/api-catalog.json, docs/platform/api-catalog.md
**Why:** Updated the API catalog generator so inline query config expressions are treated as query analysis windows. The extractor now parses the handler config argument for query extraction, traverses local helper calls from inline query functions, and preserves existing fallback behavior for identifier query helpers. Regression coverage was added for inline query functions that combine direct params.get access with local helpers using params.get and queryString.

### 2026-07-03T10-19-09: API catalog method config parsing uses balanced handler args
**By:** Mouse
**What:** API catalog method config parsing uses balanced handler args
**References:** src/tools/api-catalog.ts, tests/api-catalog-generation.test.ts, docs/platform/api-catalog.json, docs/platform/api-catalog.md
**Why:** Fixed API catalog generation to derive schema flags, body fields, and query extraction from the parsed handler config argument instead of a fixed source window. Also made named function body extraction skip TypeScript return annotations with object/generic types so helpers like placementQuery are scanned. Regenerated docs after validating the placement GET now reports only query seedLevel and no POST body fields.

### 2026-07-03T12-06-15: Small utility/provider coverage raised above 98% via focused edge-case tests
**By:** Switch
**What:** Small utility/provider coverage raised above 98% via focused edge-case tests
**References:** src/lib/scraper/providers/huffpost.ts, src/lib/scraper/providers/nbc.ts, src/lib/scraper/providers/time.ts, src/lib/ai/runner.ts, src/lib/leveling/cefr-primitives.ts, src/lib/runtime-config/storage.ts, src/lib/safe-json.ts, src/lib/frequency-ranks.ts, src/lib/learning/skill-mastery.ts, scripts/scrape-review.ts, src/lib/observability/errors.ts
**Why:** Added focused tests for the remaining owned below-threshold small files: provider URL-filter exclusions, AI runner defensive exhausted-retry branch, CEFR unknown-level range branch, removed database storage fallback, safe-json default replacement seam, frequency-rank fallback data, skill-mastery malformed/invalid recent evidence, scrape-review Postgres/main-detection branches, and observability best-effort failure handling. Validation passed targeted Node tests, targeted ESLint, and git diff whitespace checks. Full node coverage gate now reports only forbidden src/tools/api-catalog.ts below 98%, so the owned files in this task likely reached the threshold without behavior changes.

### 2026-07-03T12-06-51: Raised batch synthesis script coverage above 98%
**By:** Tank
**What:** Raised batch synthesis script coverage above 98%
**References:** scripts/batch-synthesis.ts, tests/batch-synthesis.test.ts
**Why:** Added focused native Node tests for scripts/batch-synthesis.ts covering CLI parsing and validation, selection filters, SSML/job construction, Azure request/poll/download paths, result parsing/persistence fallbacks, runOnce, loop controls, abortable sleep, and main entry paths. Added a behavior-preserving testability export plus injectable persistence dependencies so tests can cover persistence without writing to system temp. Targeted coverage now reports scripts/batch-synthesis.ts at 99.26% line coverage, and the full node coverage gate passed at threshold 98%.

### 2026-07-03T12-07-08: Coverage added for API catalog static-analysis and Prisma initialization
**By:** Mouse
**What:** Coverage added for API catalog static-analysis and Prisma initialization
**References:** tests/api-catalog-generation.test.ts, tests/helpers/prisma-module.ts, tests/prisma-*.test.ts
**Why:** Added focused regression tests only in owned test areas. API catalog tests now exercise parser edge cases (comments/template literals, helper windows, body/query/status extraction, JSON-only markdown). Prisma coverage uses isolated test files with mocked adapters/client/db-utils so each module initialization branch is covered without production changes. Targeted and full Node coverage now report src/tools/api-catalog.ts and src/lib/prisma.ts at or above 98%.

### 2026-07-03T12-19-36: Use a narrow mutable env seam for Prisma helper NODE_ENV mutation
**By:** Mouse
**What:** Use a narrow mutable env seam for Prisma helper NODE_ENV mutation
**References:** tests/helpers/prisma-module.ts
**Why:** Fixed tests/helpers/prisma-module.ts by routing DATABASE_URL and NODE_ENV test mutations through a narrow MutableProcessEnv helper instead of assigning/deleting process.env.NODE_ENV directly. This preserves the Prisma module test isolation behavior while satisfying shared typecheck's readonly NODE_ENV typing and avoids broad `as any` casts.

### 2026-07-03T12-20-14: Fixed batch synthesis typecheck regressions
**By:** Tank
**What:** Fixed batch synthesis typecheck regressions
**References:** batch-synthesis coverage slice, tests/batch-synthesis.test.ts, scripts/batch-synthesis.ts
**Why:** Aligned batch synthesis tests with current shared contracts: Article fixtures now use ArticleStatus, SpeechConfig fixtures include format, saveSpeechResult doubles return booleans, and the unzip dependency seam accepts the behavior actually needed by persistJobResults without relying on execFile's overloaded PromiseWithChild shape. Validation passed for targeted tests, lint, diff whitespace, full typecheck, and node coverage gate.

### 2026-07-03T20-00-05: Fix Today render errors by allowing rich PageHeader eyebrows and preserving server-rendered Tooltip children
**By:** Trinity
**What:** Fix Today render errors by allowing rich PageHeader eyebrows and preserving server-rendered Tooltip children
**References:** issue #875, /today, src/components/ui/PageHeader.tsx, src/components/ui/Tooltip.tsx, e2e/today.spec.ts
**Why:** For issue #875, I changed PageHeader eyebrow from a <p> wrapper to a token-styled <div> so Today can pass Inline without invalid <p><div> markup. I also updated Tooltip to render children untouched instead of cloneElement, because ArticleCardView passes server-rendered CEFR badge content through the client Tooltip and cloning caused Next SSR to emit 'Element type is invalid'. Added Today Playwright coverage that fails on the known React render error patterns while still asserting the Today h1 is visible.
## Archived 2026-07-14T11:21:02.658+00:00

### 2026-07-05 — ReadWise release workflow runs only for versioned release inputs

**Source:** Tank inbox (`decisions/inbox/tank-release-workflow-version-gate.md`)

The main release workflow is named for ReadWise, validates `package.json` against `CHANGELOG.md`, installs dependencies, generates Prisma, and runs `npm test`; it now runs on manual dispatch or pushes touching version/release metadata instead of every main push. This aligns release validation with ReadWise's current test layout/runbook and avoids noisy stale release failures when package metadata is unchanged.

### 2026-07-05 — UI audit Playwright suite is split by semantic subsystems

**Source:** Trinity inbox (`decisions/inbox/trinity-ui-audit-semantic-split.md`)

The legacy numeric `e2e/ui-audit-500.spec.ts` file was replaced by semantic subsystem specs for public/auth, reader learning, classroom, and admin operations. Shared route catalog, artifact, and runner support lives in `e2e/support/ui-audit.ts`; the canonical grep tag is now `@ui-audit` instead of the old numeric `@ui-audit-500` label.

**Validation:** Switch verified discovery/listing at 500 tests across the 4 semantic files, `@ui-audit` grep compatibility, 50 high-risk tests, targeted `admin-ai-ops` passing 10 tests, targeted ESLint for the audit files, and `npm run typecheck -- --pretty false`.

### 2026-07-06T04-03-51: Keep DB performance telemetry privacy-safe by default
**By:** Scribe
**What:** Keep DB performance telemetry privacy-safe by default
**References:** Tank, Switch, DB query performance work
**Why:** Slow-query warnings and DB tracing should report timing/operation metadata without logging SQL text, bind values, prompts, article text, selected text, or raw database error text. Performance observability is needed, but it must preserve the repository privacy rule against logging user-private content or secrets.

### 2026-07-06T04-03-51: Refuse DB benchmarks against remote databases by default
**By:** Scribe
**What:** Refuse DB benchmarks against remote databases by default
**References:** Tank, Switch, DB query performance work
**Why:** The benchmark command should refuse remote database URLs by default and do so before importing Prisma/runtime database code. Benchmarking should not accidentally exercise production-like or remote databases, and early refusal keeps the safety check lightweight and independent of Prisma initialization.

### 2026-07-05: Scraper CLI coverage uses explicit test seams
**By:** Mouse
**What:** Added `__scrapeProviderTest` and `__readingSourcesTest` seams plus injectable argv/spawn parameters so provider scraping CLI workflows can be covered without network, DB, browser, or child-process side effects.
**Why:** Native coverage now measures these runtime scripts; meaningful tests need to exercise discovery/resume/status/review/scrape behavior while preserving graceful fallback behavior and avoiding coverage-policy weakening.

### 2026-07-06: Content-free Prisma query timing is the backend performance signal
**By:** Tank
**What:** Add app-side Prisma timing through low-cardinality metrics/traces and slow-query warnings using provider/model/operation/outcome labels only, controlled by DB_QUERY_TIMING_ENABLED and DB_SLOW_QUERY_THRESHOLD_MS.
**Why:** Performance tuning needs DB latency visibility without exposing SQL text, parameters, article content, prompts, selections, user-private content, secrets, or raw ids in logs or metrics.

