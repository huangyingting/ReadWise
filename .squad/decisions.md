# Squad Decisions

## Active Decisions

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

### 2026-07-05 — ReadWise release workflow runs only for versioned release inputs

**Source:** Tank inbox (`decisions/inbox/tank-release-workflow-version-gate.md`)

The main release workflow is named for ReadWise, validates `package.json` against `CHANGELOG.md`, installs dependencies, generates Prisma, and runs `npm test`; it now runs on manual dispatch or pushes touching version/release metadata instead of every main push. This aligns release validation with ReadWise's current test layout/runbook and avoids noisy stale release failures when package metadata is unchanged.

### 2026-07-05 — UI audit Playwright suite is split by semantic subsystems

**Source:** Trinity inbox (`decisions/inbox/trinity-ui-audit-semantic-split.md`)

The legacy numeric `e2e/ui-audit-500.spec.ts` file was replaced by semantic subsystem specs for public/auth, reader learning, classroom, and admin operations. Shared route catalog, artifact, and runner support lives in `e2e/support/ui-audit.ts`; the canonical grep tag is now `@ui-audit` instead of the old numeric `@ui-audit-500` label.

**Validation:** Switch verified discovery/listing at 500 tests across the 4 semantic files, `@ui-audit` grep compatibility, 50 high-risk tests, targeted `admin-ai-ops` passing 10 tests, targeted ESLint for the audit files, and `npm run typecheck -- --pretty false`.


### 2026-07-07 — Treat CEFR/Lexile-like difficulty scores as deterministic baselines pending calibration

**Source:** Scribe session synthesis (`log/2026-07-07T07-54-41.474+00-00-difficulty-calibration.md`)

Current CEFR and Lexile-like algorithms are useful deterministic baselines because they are repeatable and available without optional providers, but they should not be treated as calibrated or authoritative labels yet. Mouse's local DB evaluation found 3 article rows compressed to B1/1030 low-confidence outputs with one stored/current mismatch; Tank confirmed the implementation is heuristic formula-based; Switch confirmed evaluation evidence needs to measure distribution quality, not just execution.

**Priority recommendations:**
1. Preserve and surface low-confidence caveats for short or sparse text.
2. Relabel the current Lexile output as Lexile-like unless/until calibrated against a labeled corpus.
3. Improve tokenization/sentence handling before relying on fine-grained level distinctions.
4. Prefer stale-version processing selection so changed scoring versions recompute mismatched or stale article rows.
5. Build a labeled evaluation corpus with gold fixtures, aggregate snapshots, and calibration metrics before raising confidence in CEFR/Lexile-like labels.


### 2026-07-07 — Correction: provider DB evaluation supersedes e2e.db difficulty sample

**Source:** Scribe correction session (`log/2026-07-07T08-02-46.354+00-00-difficulty-calibration-correction.md`)

The earlier `prisma/e2e.db` empirical result recorded for CEFR/Lexile-like difficulty analysis is superseded for this analysis. The corrected evaluation protocol uses smaller provider databases under `prisma/provider-dbs/*`, with Mouse's rerun on `prisma/provider-dbs/workinprogress.db` (8,335,360 bytes, 217 articles) as the representative provider evidence.

Corrected findings: CEFR B1 208 (95.9%), B2 7 (3.2%), A2 2 (0.9%); Lexile-like min 590, median 870, mean 861.66, max 1050; confidence high 165, medium 52, low 0. `prisma/e2e.db` should be treated only as a non-representative smoke observation. Provider DB evidence still shows B1 compression and reinforces the need for calibration before treating CEFR or Lexile-like labels as authoritative.


### 2026-07-07 — CEFR calibration v2 remains heuristic pending gold-corpus validation

**Source:** Scribe session synthesis (`log/2026-07-07T09-08-07.205+00-00-difficulty-calibration-v2.md`)

`deterministic-cefr/wordfreq-calibrated-v2` calibrates CEFR thresholds from temporary UniversalCEFR/elg_cefr_en evidence, which is CC BY-NC 4.0. Raw calibration text was not committed, and the calibration source should be treated as temporary/non-commercial evidence rather than a durable product corpus.

Implementation changed thresholds only, bumped `DIFFICULTY_ALGORITHM_VERSION`, and selected rows with stale `difficultyVersion` or missing `lexileApprox` for recomputation. Provider DB evaluation used `prisma/provider-dbs/workinprogress.db` only: baseline v1 A2 2 / B1 208 / B2 7 changed to v2 B2 2 / C1 141 / C2 74, while Lexile-like values stayed min 590, median 870, mean 861.66, max 1050.

Decision/caveat: present CEFR v2 as a heuristic/calibrated deterministic baseline, not authoritative CEFR. There is no committed reproducible calibration harness/snapshot, and the new distribution skews advanced; stronger gold corpus validation is required before raising confidence or product authority claims.


### 2026-07-07 — OneStopEnglish v3 calibration accepted with ordinal-anchor caveats

**Source:** Tank inbox (`decisions/inbox/Tank-onestopenglish-calibrated-cefr-threshold-v3.md`) plus Morpheus independent revision and Switch approval.

`deterministic-cefr/onestop-calibrated-v3` is accepted as the current deterministic CEFR threshold calibration. The calibration uses aggregate OneStopEnglish article-level evidence licensed CC BY-SA 4.0; raw OneStopEnglish text was not committed to the repository or Squad state.

**Decision/caveats:** OneStopEnglish labels (`elementary`, `intermediate`, `advanced`) are ordinal calibration anchors, not exact A1-C2 gold labels. CEFR output remains a heuristic/calibrated deterministic estimate rather than authoritative CEFR certification. Lexile output remains Lexile-like and was not changed by the v3 calibration.

**Implementation/review record:** Tank implemented the initial v3 change, but Switch rejected it as not merge-ready because lexical normalization failed on constructor-shadowed maps and caveats were not explicit enough. Reviewer lockout was enforced; Morpheus independently revised the implementation with own-property guarded lookups for contraction/irregular maps and explicit license/mapping caveats in tests/docs. Switch re-reviewed and approved.

**Validation:** `git diff --check` passed; targeted Node tests passed (88); `npm run typecheck` passed; targeted ESLint passed. Provider aggregate validation used 19 `prisma/provider-dbs/*.db` files only, excluded root DBs and sidecars, and covered 286,985 article rows. Final aggregate: A1 23, A2 9,134, B1 60,820, B2 184,428, C1 32,578, C2 2; average score 38.04; average Lexile-like 842.21.


### 2026-07-09 — Difficulty calibration harness stays aggregate-only and license-gated

**Source:** Tank inbox (`decisions/inbox/tank-difficulty-eval-harness.md`) plus Mouse methodology, Morpheus independent revision, and Switch approval.

The difficulty calibration harness is accepted as a read-only evaluation path for CEFR/OneStop-style ordinal calibration, provider drift, Lexile-like metrics, and vocabulary audits. It must keep raw calibration datasets, article text, selected text, and other license-restricted or user-private content outside the repository and Squad state; committed fixtures/templates may describe schemas and labels but must not include article text.

**Decision/caveats:**
1. Harness reports are aggregate-only and live under `.calibration-state/`; human labels are allowed only without article text.
2. Provider DB scans are restricted to `prisma/provider-dbs/*` and must exclude root Prisma DBs and sidecars.
3. Dataset source metadata must record license and non-commercial status. Non-commercial datasets require explicit `--enable-nc` opt-in; OneStopEnglish CC BY-SA remains default-allowed, while UniversalCEFR, Cambridge, CEFR-SP, and NC-marked sources require opt-in.
4. Vocabulary audits must remain MIT-safe, and provider drift thresholds should be treated as calibration guardrails.
5. Lexile output remains Lexile-like wording only, not official Lexile.

**Implementation/review record:** Tank implemented `scripts/difficulty-eval.ts`, `npm run difficulty:eval`, docs/tests/template/package updates, and the provider smoke, but Switch rejected the first version because it lacked the NC dataset gate. Reviewer lockout was enforced against Tank; Morpheus independently added the explicit `--enable-nc` gate, `datasetSources` license/non-commercial metadata, and docs/tests updates. Switch re-reviewed and approved.

**Validation:** difficulty eval script tests passed 9/9; ESLint passed; typecheck passed; `git diff --check` passed; provider smoke was scoped to `prisma/provider-dbs/*` only and aggregate-only.


### 2026-07-09 — Hybrid v4 CEFR calibration uses legal-approved NC data plus OneStopEnglish ordinal anchors

**Source:** Tank inbox (`decisions/inbox/tank-hybrid-calibration-v4.md`) plus Mouse v4 target synthesis and Switch approval.

`deterministic-cefr/hybrid-calibrated-v4` is accepted as the current deterministic CEFR threshold calibration. The implementation is threshold-only with cutoffs `[9,18,27,36,50]`, uses legal-approved UniversalCEFR/elg_cefr_en A1-C2 aggregate evidence only behind the explicit `--enable-nc` gate, and retains OneStopEnglish article labels as ordinal anchors.

**Decision/caveats:** NC evidence is legally approved for this repository's calibration work when explicitly enabled, but raw calibration data remains outside the repository and Squad state. OneStopEnglish labels remain ordinal anchors, not exact A1-C2 gold labels. CEFR output remains a heuristic/calibrated deterministic estimate rather than authoritative CEFR certification. Lexile output remains Lexile-like and was not changed by v4.

**Validation:** NC exact/within-one improved from v3 `.095/.450` to v4 `.308/.798`; OneStopEnglish exact/within-one improved from v3 `.485/.984` to v4 `.499/.995`. Switch approved after diff check, ESLint, typecheck, targeted Node tests (54/54), and provider filter/count/aggregate smoke. Provider aggregate used 19 `prisma/provider-dbs/*.db` files only, covering 286,985 articles: A2 191, B1 8,966, B2 97,611, C1 179,138, C2 1,079; average score 38.042, p50 38; Lexile-like average 842.206, p50 850.

## 2026-07-10 — PR #965 Review (Issue #962)
**Reviewer:** Morpheus | **Verdict:** REQUEST_CHANGES
**Blocking:** Six identical `TODAY_ROUTE_FEATURE_GATE` declarations across six routes replaces one duplication pattern with another. Must extract to a single shared Today-domain module (e.g. `src/lib/engagement/today-session/feature-gate.ts`).
**Green:** Behavior preserved, gate ordering correct, tests adequate, no `any`/casts/new deps/unrelated changes, CI typecheck+lint pass, PG failure pre-existing.
**Action:** Tank locked out. Switch must revise with exact deltas: extract shared gate, update six route imports.

## 2026-07-10 — PR #965 Cycle 2 Re-Review (Morpheus)

**Verdict:** REQUEST_CHANGES  
**Blocking delta:** CI "Unit tests + native coverage" fails — `reflection/route.ts` at 95.45% < 98% threshold (lines 40-41 uncovered: `!result.ok` error branch). PR adds tests that import the route (making it measured) without covering the error path.  
**Architecture:** APPROVED — single canonical gate, zero duplicates, correct dependency direction, clean export surface.  
**Cycle-3 owner:** Switch (not locked out — cycle 2, not final rejection).  
**Fix required:** One additional test exercising `recordTodayReflection → { ok: false }`.  
**Comment URL:** https://github.com/huangyingting/ReadWise/pull/965  


### 2026-07-10 — PR #973 Review (Issue #948 partial delivery)

**Reviewer:** Morpheus | **Verdict:** REQUEST_CHANGES (CI gate only)
**Technical verdict:** APPROVE — all boundary, type-safety, provider, frozen-file, and test gates pass.
**Blocking:** "Unit tests + native coverage" CI pending at review time. Cannot verify 98% coverage gate.
**Comment URL:** https://github.com/huangyingting/ReadWise/pull/973#issuecomment-4936920771
**Findings:**
1. All removed barrel exports have zero legitimate external consumers (verified via grep).
2. Flashcard grade cast removal is type-safe (`oneOf(GRADES)` infers exact `Grade` union).
3. Lazy provider: same singleton identity, improved error semantics (caller-visible vs import-time), no test leakage, no privacy change.
4. Frozen files untouched, #948 open, #972 exact/deduplicated.
**Gate:** Merge when "Unit tests + native coverage" CI passes green. If fails, Mouse locked, Switch revises.


## Recent Strategic Decisions (Post-Refactor)

### 2026-07-10T05-51-36: Repository-wide refactor program: dev-first staged flow with 6-wave dependency-aware sequencing
**By:** Morpheus
**What:** Repository-wide refactor program: dev-first staged flow with 6-wave dependency-aware sequencing
**References:** #939, #940, #941, #942, #943, #944, #945, #946, #947, #948, #949, #950, #951, #952, #953, #954
**Why:** ## Decision

Adopted a 6-wave, dependency-aware refactor program (#939) using the git-workflow skill's dev-first model. Remote `dev` must be bootstrapped from `main` (#940) before any subsystem work begins.

## Branch strategy
- Bootstrap `dev` from current `main` HEAD (one-time, #940)
- All subsystem PRs target `dev` using `squad/{issue-number}-{slug}` branches
- PR #937 (Dependabot ESLint) remains targeting `main` independently
- Final promotion: reviewed PR `dev` → `main` (#954) after all waves complete

## Wave ordering (13 subsystem issues)
- Wave 1: Foundation — shared primitives/errors (#941), runtime-config/observability (#942)
- Wave 2: Platform — auth consolidation (#943), API handler/security patterns (#944)
- Wave 3: Domain services — AI boundaries (#945), scraper/content-pipeline dedup (#946), speech/push/jobs (#947)
- Wave 4: Product domain — learning/vocabulary (#948), article/reader/difficulty (#949), classroom/org/analytics (#950)
- Wave 5: UI — primitives/shared (#951), reader state (#952)
- Wave 6: Cross-cutting — scripts/hooks/test-infra (#953)

## Concurrency rule
No two agents edit the same shared file concurrently. Shared files (api-handler, prisma.ts, test helpers, runtime-config barrel) are frozen unless coordinated through Morpheus.

## Termination condition
Program complete when all subsystem issues closed, `dev` passes full CI, and promotion PR merges to `main`.

## Rollback
Each subsystem PR is independently revertable on `dev`. Main is never force-pushed.

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
