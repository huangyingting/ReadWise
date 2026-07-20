# Archived Squad Decisions

- Archived by: Scribe
- Archived at: 2026-07-20T15:35:35Z
- Source: .squad/decisions.md
- Rule: decisions.md was 75180 bytes; archived entries older than 7 days (cutoff 2026-07-13T15:35:35+00:00).

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

## Feature-Completeness Epic #1008 Scope Decisions (2026-07-11)

### 2026-07-11T22:31:57: Classroom membership remains teacher-managed
**By:** Copilot (user directive)
**What:** For feature-completeness epic #1008, maintain classroom membership as teacher-managed only.
**Why:** Student self-service joining via invite links or codes is intentionally out-of-scope for the completeness roadmap. Teacher-driven classroom formation and membership management aligns with the deployment model and administrative governance patterns.
**Implication:** #1008 child issues must not include student self-service joining/invite-code flows; scope those for future roadmap phases.

### 2026-07-11T22:31:57: Defer topology and corpus-dependent automation
**By:** Copilot (user directive)
**What:** Do not add repository-owned backup automation without a committed production deployment topology; do not fabricate difficulty gold-corpus results when prisma/provider-dbs/* is absent.
**Why:** Deployment topology (high-availability, failover, RTO/RPO) is external-facing and requires production operations alignment; corpus-dependent calibration (difficulty gold labels) requires approved provider data and legal review. Both require external input unavailable in the development environment.
**Implication:** Retain the current provider-neutral backup/restore runbook. Retain the aggregate-only, license-gated difficulty evaluation harness. Defer empirical calibration until approved provider databases are integrated.

### 2026-07-11T22:31:57: Prefer evidence-backed autonomous defaults
**By:** Copilot (user directive)
**What:** When decisions would normally require human confirmation, use the safest evidence-backed best guess instead. Escalate only for permissions, safety, destructive impact, or unavailable external input.
**Why:** Reduces decision latency and team blocking while maintaining safety guardrails. Evidence-backed defaults for API changes, non-breaking refactors, or design choices are preferable to pausing for async confirmation.
**Implication:** Squad agents use this authority for scope/design questions during Wave 1–5. Morpheus evaluates evidence and owns escalation decisions when the autonomous default is insufficient.


## Wave 1 Feature-Completeness Completions (2026-07-12)

### 2026-07-11T22:31:57.145+00:00 — Admin series page intentionally omits article-picker and reorder UI
**By:** Trinity
**What:** #1018 /admin/series stays focused on core metadata and status lifecycle; it does not add an articleIds picker or drag-and-drop reorder UI.
**Why:** The #1015 API already supports articleIds and reorder, but #1018 acceptance criteria only require minimal curation UX. Picker/search and drag-and-drop would add substantial interaction design without changing the approved metadata lifecycle, so they belong in a follow-up issue with dedicated UX work.
**Implication:** Keep #1018 scoped to create/edit/status/delete flows; treat article selection and reorder as future enhancements.

### 2026-07-12T01:54:08: PR #1020 admin-member-detail browser coverage completion
**By:** Morpheus (approver), Tank (revised author)
**What:** Completed issue #1012 — native fixture coverage restored to >=98% on admin/member-detail module alongside comprehensive Chromium E2E scenarios.
**Why:** Initial PR head rejected due native coverage regression without browser evidence. Tank revised at 520609e with both seedE2eMember unit test restoration and 10/10 E2E scenarios. Morpheus approved; merged to dev as 730bfc8.
**Implication:** Helper executable code requires native fixture coverage alongside browser coverage; strict reviewer lockout on native debt regressions is correctness enforcement, not gatekeeping.

### 2026-07-12T01:54:08: PR #1021 onboarding wizard E2E completion
**By:** Morpheus (approver), Trinity (author)
**What:** Completed issue #1009 — five-step onboarding E2E journey wired into canonical smoke gate with real keyboard activation assertions.
**Why:** Initial cycle approved with advisory: spec existed but was not in canonical CI (`npm run e2e:smoke`). Coordinator validation required cycle 2 because tabIndex assertions were tautological. Trinity revised at c3e3fd7 wiring spec into canonical smoke and replacing helper checks with real keyboard navigation. Morpheus independently approved; merged to dev as 919da904.
**Implication:** Executable E2E specs must be wired into canonical CI commands (not standalone decorators); tautological helper assertions must be replaced with real user-interaction verification.

## Inbox Decision Merges 2026-07-12T02:41:59.148+00:00

---
id: 1bfdfbde-6c21-4559-a35a-13421cae66cb
class: DECISION
loadGuidance: [ALWAYS]
title: "Provider DBs for CEFR/Lexile evaluation"
author: "Squad"
createdAt: 2026-07-07T08:03:23.470Z
metadata: {}
---

User directive on 2026-07-07T08:02:46.354+00:00: For CEFR/Lexile algorithm evaluation, use smaller databases from prisma/provider-dbs/*, not databases directly under prisma/. Previous use of prisma/e2e.db should be replaced with provider DB evaluation.

---
id: 16857482-fc68-4e4e-afb2-dbd0adde22e2
class: DECISION
loadGuidance: [ALWAYS]
title: "NC CEFR data legal approval"
author: "Squad"
createdAt: 2026-07-09T12:18:42.670Z
metadata: {}
---

User stated on 2026-07-09T12:18:22.400+00:00: "I have the legal approval, can we use v2". Treat NC CEFR datasets as approved for this repository's calibration work when explicitly enabled, while still preserving license metadata and no-raw-text handling.

### 2026-07-10T06-06-37: PR #955 retrospective: Branch protection configuration defects require pre-deployment validation and decision alignment
**By:** Switch
**What:** PR #955 retrospective: Branch protection configuration defects require pre-deployment validation and decision alignment
**References:** PR #955, decision #940, issue #940, tests/db/postgres-jobs.test.ts
**Why:** ## Retrospective: PR #955 Rejection

**Ceremony Role:** Switch (substitute facilitator, fact synthesis only). Morpheus (original author) is locked out by reviewer protocol. Tank is independent revision owner.

---

## Facts

**PR #955 Status:** OPEN, REQUEST_CHANGES (2026-07-10T06:04:39Z)

**CI Check Outcomes:**
- ✅ 4 passing checks: Build, Fast checks, Supply-chain hygiene, Dependency review, smoke test
- ❌ 2 failing checks: PostgreSQL Migrate/Integration, Unit tests + native coverage (E2E skipped, non-blocking)

**Code Review Verdict:** Two critical blocking defects in branch protection configuration (not in code/docs/YAML of PR itself):

1. **BLOCKING-1 — Required Check Name Mismatch**
   - Configured context: `"Supply-chain hygiene"` (GitHub API exact match)
   - Actual CI job name: `"Supply-chain hygiene (lockfile + audit)"`
   - Effect: GitHub will never receive matching status; check permanently shows pending/missing on all `dev` PRs
   - Fix: Change branch protection context to `"Supply-chain hygiene (lockfile + audit)"`

2. **BLOCKING-2 — Pre-existing PostgreSQL Test Failure**
   - Test: `tests/db/postgres-jobs.test.ts:27` (worker/processor article state)
   - Assertion: line 87 (actual includes 'dbit_processor_enriched_...' not in expected)
   - Consistency: deterministic failure across all 5 recent main-branch runs
   - Codebase state: pre-existing on `origin/main` HEAD c65355904c3c8c9d8782c5a809b156899a6b9cb6
   - Scope misalignment: Issue #940 (coverage strategy decision) lists required checks as `typecheck / lint / unit-tests / build` only; PostgreSQL integration not intended
   - Effect: Making PostgreSQL required on `dev` blocks all future PRs from day one
   - Fix: Repair test on main first, then add to required checks; or keep as non-required per decision #940

---

## Root Causes

1. **No pre-deployment CI validation:**
   - Branch protection applied without first verifying all proposed required checks pass on target branch
   - Required check names not synchronized with actual CI job names
   - No smoke test or sync step in implementation workflow

2. **Insufficient decision alignment:**
   - PostgreSQL was added to required checks without consulting decision #940
   - Test failure pre-existing and known; no pre-implementation check

3. **Lack of separation between feature and infrastructure work:**
   - Branch protection (high-impact platform-level change) bundled with feature bootstrap
   - No dedicated review gate or approval step before platform changes went live

---

## Process Changes Required

1. **Mandate pre-deployment validation for branch protection:**
   - Run CI on target branch; verify all proposed required checks pass
   - Sync required check names with actual CI job names in workflow definition
   - Document validation evidence in PR

2. **Enforce decision alignment before implementation:**
   - Review decision log (e.g., #940) before implementing branch protection or required checks
   - Escalate and update decision if implementation diverges

3. **Separate branch protection from feature branches:**
   - Extract infrastructure work (branch protection, required checks) to dedicated PRs
   - Easier to review, validate, and potentially roll back

4. **Conservative default on required checks:**
   - Never add a check to required until you have evidence it passes on target or main
   - If test is long-failing, fix first or explicitly defer as non-required

---

## Action Items

| ID | Action | Owner | Priority |
|----|--------|-------|----------|
| A1 | Fix branch protection: change required context from `"Supply-chain hygiene"` to `"Supply-chain hygiene (lockfile + audit)"` | Tank | 🔴 Blocker |
| A2 | Fix `tests/db/postgres-jobs.test.ts:87` on main OR remove PostgreSQL from required checks until fixed | Tank (primary) | 🔴 Blocker |
| A3 | Document branch protection validation runbook (pre-deployment CI check, name sync, decision review) | Infrastructure/Tank | 🟠 High |
| A4 | Confirm branch protection scope with decision #940 author and Tank | Team | 🟠 High |
| A5 | Extract infrastructure work to separate PRs in future (not bundled with feature bootstrap) | Team (process) | 🟡 Medium |

---

## Decision

**Branch protection with required status checks must pass pre-deployment validation:**
- Required checks must be synchronized with actual CI job names
- All proposed required checks must pass on target branch before deployment
- Implementation must align with prior architectural decisions
- Platform-level changes require separate review and validation gates

This decision applies to all future branch protection work in the repository.

### 2026-07-10: Bootstrap merge sequence completed

**By:** Tank
**What:** Executed the two-PR bootstrap merge sequence (#955 → #957) into dev.
**Why:** One-time escape from circular bootstrap: #955 installed dev CI triggers; #957 repaired the pre-existing coverage gate. Sequence was evidence-backed with Switch APPROVE (#955) and Mouse APPROVE (#957), all four required checks green on #957 before merge.

## Merge SHAs
- PR #955 merge commit: `4c70523c961a939a1f5f6c1149f546eb92af4dac`
- PR #957 merge commit: `5e5044e3e2c4f77406936f93615b3be05ca8379a`
- Final dev SHA: `5e5044e3e2c4f77406936f93615b3be05ca8379a`

## Required-check results (PR #957)
| Check | Result |
|---|---|
| Fast checks (typecheck + lint) | ✅ PASS |
| Unit tests + native coverage | ✅ PASS |
| Build | ✅ PASS |
| Supply-chain hygiene (lockfile + audit) | ✅ PASS |
| PostgreSQL Migrate / Integration | ❌ FAIL (non-required, known baseline) |

## Issue states
- #940: CLOSED
- #956: CLOSED

## Cleanup
- Worktrees `/home/azadmin/ReadWise-940` and `/home/azadmin/ReadWise-956` removed
- Remote branches `squad/940-bootstrap-dev` and `squad/956-restore-coverage-gate` deleted
- Local feature branches deleted
- Main checkout remains on `main` (unchanged)
- PR #937 untouched (OPEN)

## Post-merge CI
- Run: https://github.com/huangyingting/ReadWise/actions/runs/29076660254
- Status at handoff: in_progress (not yet complete — do not claim success until it finishes)

### 2026-07-10T10-32-38: PR #965 Retrospective: Duplication anti-pattern in feature-gate extraction
**By:** Morpheus
**What:** PR #965 Retrospective: Duplication anti-pattern in feature-gate extraction
**References:** PR #965, Issue #962, Tank (author, locked out), Switch (revision owner)
**Why:** ## Root Cause
Tank created six identical `TODAY_ROUTE_FEATURE_GATE` const definitions across six route files instead of extracting to a single shared Today-domain module. This replaced repeated conditionals with repeated policy objects—a duplication anti-pattern that defeats the "single source of truth" principle.

## Process Learning
Feature-gate extractions require a two-move operation:
1. Extract the abstraction (seam: `defineFeatureGate`, `enforceFeatureGate` imports)
2. Extract the configuration (policy object) to a canonical module once, not replicated N times

Principle: No route/handler should carry its own policy object. Gates are infrastructure defined once in the domain they protect, then imported by N consumers.

## Objective Deltas for Switch
1. Create `src/lib/engagement/today-session/feature-gate.ts` exporting `TODAY_ROUTE_FEATURE_GATE`
2. Update 6 route files to import the shared gate instead of defining locally
3. Keep all behavior/error handling identical; no API contract changes
4. Validate: typecheck, lint, targeted route tests (56 passing)

**Constraints:** No upward dependency cycle from today-session. Tank locked out (original author, REQUEST_CHANGES protocol). Switch owns revision independently.

### 2026-07-10T10-48-29: PR #965 Cycle-2 Rejection: CI Coverage Failure Analysis

**By:** Morpheus (retrospective synthesis)

**Participants:**
- Tank: Locked (revision 1 author, protocol override)
- Switch: Locked (revision 2 author, REQUEST_CHANGES protocol)
- Mouse: Eligible cycle-3 owner (independent revision)

**What:** Cycle-2 rejection root cause synthesis: Switch's revision 2 correctly refactored policy duplication away, but the reflection route (`src/app/api/today/reflection/route.ts`) became measured without corresponding test coverage for the error path.

**Objective Evidence**

**File:** `src/app/api/today/reflection/route.ts`
- **Lines 40-41** (`!result.ok`): Error path now **uncovered** post-refactor
- **Current behavior:** Route catches `!result.ok`, maps to `ApiError(result.status, result.error)`, throws
- **Test gap:** No test exercises `recordTodayReflection() → {ok: false}` failure case

**Root Cause**

Switch's revision correctly extracted `TODAY_ROUTE_FEATURE_GATE` to `src/lib/engagement/today-session/feature-gate.ts` and updated six route files to import it instead of defining locally. However:

1. The reflection route became measured (captured in CI coverage snapshot)
2. During refactoring, no error-path test was added for `recordTodayReflection` failure
3. CI coverage gate (98%) fails on lines 40-41: `!result.ok` throws error, untested

**Process Safeguard**

Feature refactorings that add measurement must include test coverage for all error branches before merge.

**Objective Action Item (Cycle-3)**

Single, precise delta for Mouse:
- **Add one test** to `tests/` exercising `recordTodayReflection → {ok: false}`
- **Assert** the route returns the mapped error response (e.g., status and error field)
- **Verify:** CI coverage gate passes (lines 40-41 now covered)

**Constraints:**
- No code refactoring beyond adding the test
- Tank and Switch remain locked (protocol: no revision contribution from prior cycle authors)

---
**Summary Counts:**
- **Locked agents:** 2 (Tank/revision-1, Switch/revision-2)
- **Eligible owners:** 1 (Mouse)
- **Root causes:** 1 (unmeasured error path)
- **Action items:** 1 (add reflection failure test)

### 2026-07-10: Add reflection route error-path test for cycle-3 coverage blocker

**By:** Mouse
**What:** Added `tests/today-reflection-error.test.ts` with 2 tests covering the `!result.ok` branch (lines 40-41) of `src/app/api/today/reflection/route.ts`.
**Why:** CI coverage gate failed at 95.45% (uncovered lines 40-41). The tests mock `recordTodayReflection` to return `{ ok: false, status, error }` and assert exact HTTP status, body `{ error, requestId }`, and `x-request-id` header — consistent with `createHandler` error contract. Route now at 100% coverage. All CI checks green. Commit: 2a2acf3. No production code changed.

### 2026-07-10T13-20-49: #951 W5a UI primitives — GO: safe to proceed before #946/#948/#949
**By:** Morpheus
**What:** #951 W5a UI primitives — GO: safe to proceed before #946/#948/#949
**References:** #939, #946, #948, #949, #951
**Why:** ## Decision: GO

### Evidence
- Active scraper work is confined to `src/lib/scraper/extract.ts`, `src/lib/scraper/providers/index.ts`, `src/lib/scraper/providers/newyorker.ts` (new), and four test files. All confirmed via `git status`.
- Full grep of `src/components/` and `src/hooks/` for `lib/scraper` import paths: **zero matches**. The UI/hook layer never imports from the scraper domain directly.
- Avatar.tsx match for "provider" is OAuth context only. Landing-content.ts "extract" is English prose. No functional cross-domain dependency exists.
- #951's scope — `src/components/ui/` (28 files), `src/hooks/{useLoadMoreList,useFilteredFetch,useMutation,useAdminAction}.ts`, `src/components/{CategoryBrowser,ForYouFeed,ArticleListingGrid}.tsx`, `src/components/teacher/*Form.tsx`, both Wordmark files — touches no file with any active dirty status.
- #948/#949 depend on #946's scraper seam (content-pipeline API contract). #951 does not consume that seam — it is a pure intra-UI/hook consolidation pass.

### Allowed Areas
- `src/components/ui/**` — full audit and token compliance sweep
- `src/hooks/useLoadMoreList.ts`, `useFilteredFetch.ts`, `useMutation.ts`, `useAdminAction.ts` — verify and enforce consistent usage
- `src/components/CategoryBrowser.tsx`, `ForYouFeed.tsx`, `ArticleListingGrid.tsx` — replace copy-pasted load-more state machines with `useLoadMoreList`
- `src/components/command/CommandPalette.tsx` — replace debounce/abort pattern with `useFilteredFetch`
- `src/components/teacher/{AddStudentForm,AssignArticleForm,CreateClassroomForm,CreateOrgForm,TeacherFormShell}.tsx` — replace `postJson` boilerplate with `useMutation`/`useAdminAction`
- `src/components/Wordmark.tsx` and `src/components/marketing/Wordmark.tsx` — resolve duplication (one canonical component)

### Frozen Areas (must not touch)
- `src/lib/scraper/**` — active intentional work on #946; lockout enforced
- `tests/providers.test.ts`, `tests/scraper-cleanup.test.ts`, `tests/scraper-extract-readability-comparison.test.ts`, `tests/scraper-providers-discovery.test.ts` — active test changes on #946
- `src/lib/content-pipeline/**` — domain seam being stabilised by #946
- Any API route files consumed by #948/#949 — must remain stable; no UI-layer code should add new scraper-domain imports

### Constraints
1. Do not introduce any import path containing `lib/scraper` or `lib/content-pipeline` in any component or hook touched by #951.
2. Wordmark consolidation is markup/token-only — no logic touching content or article pipeline.
3. Validate with: `npm run typecheck` (full pass) and `npm run lint -- src/components/ui/ src/hooks/`.
4. Smoke e2e: `npm run test:e2e:smoke` must pass before handoff.
5. #951 does not alter routes, Prisma schema, or API contracts — only presentation layer.

### Issue dependency note
#951's stated "Depends on Wave 4 completion" is a wave-ordering heuristic, not a hard import dependency. Confirmed stable: all Wave 4 domain seams that #951 touches (hooks, UI primitives) are fully merged and green per CI (#940–#945, #947, #950, #961, #962). The only outstanding Wave 4 item (#946) is in a different domain partition with no compile-time coupling to #951's file set.

### 2026-07-10T15-07-16: GO/NO-GO for #948: PARTIAL GO — vocabulary.ts rename frozen, all other domains safe to proceed
**By:** Morpheus
**What:** GO/NO-GO for #948: PARTIAL GO — vocabulary.ts rename frozen, all other domains safe to proceed
**References:** #948, #946, #939, #970
**Why:** ## Decision: PARTIAL GO for #948 (Learning/Study/Engagement/Vocabulary consolidation)

**Requested by:** Ralph Agent
**Date:** 2026-07-10

---

## Import Graph Evidence

### Coupling between #948 and #946 (the active blocker)

**Critical junction — `src/lib/vocabulary.ts`:**
- Line 3: `import { articleHtmlToReaderText } from "@/lib/content-pipeline"` → **consumes** a #946-frozen file
- `src/lib/processing/processor.ts:19`: `import { getOrCreateArticleVocabulary } from "@/lib/vocabulary"` → **is consumed by** a #946-frozen file

This places `src/lib/vocabulary.ts` at the intersection of both change sets:
- Upstream: `content-pipeline/index.ts` (#946 will restructure its exports)
- Downstream: `processing/processor.ts` (#946 will edit this file for normalization consolidation)

Moving/renaming `vocabulary.ts` → `vocabulary/service.ts` (AC #1 of #948) would require updating `processing/processor.ts`, a file frozen by active #946 work.

**All other #948 domains are clean (zero coupling to #946 files):**
- `src/lib/learning/` — no imports from `scraper/`, `content-pipeline/`, `processing/`; not imported by those modules
- `src/lib/engagement/` — same: clean
- `src/lib/study/` — same: clean
- `src/lib/lexical/` — same: clean
- `src/lib/vocabulary/` (schemas directory, existing) — same: clean

Reverse check: `scraper/`, `content-pipeline/`, `processing/` do NOT import from `learning/`, `engagement/`, `study/`, or `lexical/`. The only reverse import is `processing/processor.ts` → `vocabulary.ts`.

---

## Decision

**PARTIAL GO**: #948 may begin immediately on a bounded scope.

### ✅ ALLOWED FILES (safe to proceed now)

| Module | AC coverage |
|---|---|
| `src/lib/learning/index.ts` (barrel audit, 20-file surface) | AC #2 |
| `src/lib/engagement/index.ts` (barrel audit, 22 files) | AC #3 |
| `src/lib/study/schemas.ts` (verify placement) | AC #4 |
| `src/lib/lexical/` (clarify relationship to vocabulary) | AC #3/4 |
| `src/lib/vocabulary/` schemas dir (existing, no structural change) | AC #5 |
| Remove unjustified `any` from `learning/`, `engagement/`, `study/`, `lexical/` exports | AC #5 |

### 🚫 FROZEN FILE (must not be touched until #946 merges)

| File | Reason |
|---|---|
| `src/lib/vocabulary.ts` | Sits at content-pipeline/#946 junction; rename would force edit to `processing/processor.ts` (frozen) and may be affected by `content-pipeline/index.ts` export changes (#946 upstream) |

This means **AC #1** ("No file-vs-directory confusion — vocabulary.ts resolved") cannot be completed now. This is a real scope reduction and must NOT be silently dropped.

---

## Required Follow-Up Tracking

After #946 merges:
1. Reopen/continue #948 for the frozen AC: move `src/lib/vocabulary.ts` → `src/lib/vocabulary/service.ts` (or agreed destination)
2. Update `src/lib/processing/processor.ts` import from `@/lib/vocabulary` to the new path
3. Update `src/lib/vocabulary.ts` import of `articleHtmlToReaderText` to the new `content-pipeline` export shape
4. Re-run `npm run typecheck` and targeted tests including `tests/vocabulary.test.ts`

A follow-up sub-issue or task should be filed against #948 to track the deferred AC #1 to prevent silent scope shrinkage.

---

## Validation Constraints for PARTIAL GO work

- Run `npm run typecheck` after barrel changes
- Run `npm test -- tests/srs.test.ts tests/flashcards.test.ts tests/word-mastery.test.ts tests/engagement*.test.ts tests/study*.test.ts` (exclude vocabulary.test.ts until freeze is lifted)
- Do not touch `src/lib/vocabulary.ts`, `src/lib/processing/processor.ts`, `src/lib/content-pipeline/index.ts`, `src/lib/scraper/`

### 2026-07-10T16-14-39: PARTIAL GO — Issue #949 (W4b: Article library, reader, difficulty & recommendations): allowed/deferred seams, frozen blast-radius, and deferred child tracking requirement
**By:** Morpheus
**What:** PARTIAL GO — Issue #949 (W4b: Article library, reader, difficulty & recommendations): allowed/deferred seams, frozen blast-radius, and deferred child tracking requirement
**References:** #946, #949, #939, src/lib/scraper/providers/index.ts, src/lib/content-pipeline/index.ts, src/lib/processing/state.ts, src/lib/recommendations/scoring.ts, src/lib/article-library/admin.ts, src/lib/article-library/collections/tags.ts, src/lib/difficulty.ts, src/lib/reader/page-loader.ts, src/lib/engagement/today-session/generator.ts
**Why:** ## Decision: PARTIAL GO for Issue #949

**Requested by:** Ralph Agent
**Date:** 2026-07-10
**Depends on:** #946 (blocked by active scraper/New Yorker work)

---

## Evidence: Bidirectional Import Graph

### #949 scope → frozen (#946) scope

| #949 file | Imports | Frozen target | Status |
|---|---|---|---|
| `article-library/admin.ts:16` | `getArticleProcessingSteps`, `StepRow` | `@/lib/processing/state` | FROZEN |
| `article-library/collections/tags.ts:11` | `articleHtmlToReaderText` | `@/lib/content-pipeline` | FROZEN |
| `difficulty.ts:3` | `articleHtmlToReaderText` | `@/lib/content-pipeline` | FROZEN |
| `reader/page-loader.ts:20` | `sanitizeArticleHtml`, `articleHtmlToReaderText` | `@/lib/content-pipeline` | FROZEN |
| `recommendations/scoring.ts:35-38` | `getProviderByName`, `isProviderCategoryReadingSuitable` | `@/lib/scraper/providers` | FROZEN + UNCOMMITTED |

### frozen (#946) scope → #949 scope (reverse)

| Frozen file | Imports from #949 |
|---|---|
| `processing/processor.ts:21` | `getOrCreateArticleTags` (article-library/collections/tags) |
| `processing/processor.ts:31` | policy symbols (article-library/policy) |
| `scraper/index.ts:16` | `PUBLIC_ARTICLE_CREATE_FIELDS`, `findPublicLibraryArticleBySourceUrl` |

### Additional finding: Recommendations is NOT a pure leaf

`engagement/today-session/generator.ts:21` imports `listScoredPicksPage` from `@/lib/recommendations/picks`. Acceptance criterion "Recommendations is a leaf module with no reverse imports" is **currently false**. The engagement→recommendations direction is an intentional architectural pattern (recommendations-as-a-service), but must be explicitly reviewed and documented—not silently accepted.

### Active uncommitted work in frozen zone (git diff --name-only HEAD)

The following scraper files have uncommitted changes confirming active #946 work:
- `src/lib/scraper/declutter.ts`
- `src/lib/scraper/extract.ts`
- `src/lib/scraper/providers/index.ts` ← directly consumed by `recommendations/scoring.ts`

---

## ALLOWED — Can proceed now without touching #946 frozen files

### 1. `src/lib/leveling/` — FULL GREEN
Zero imports from frozen scope. Imports only: prisma, option-registries, profile, learning/skill-mastery, article-library (safe). Full module boundary audit, `any` removal, type-safety pass.

### 2. `src/lib/difficulty-version.ts` — FULL GREEN
Constants only, no frozen imports. Co-location decision with difficulty domain can proceed.

### 3. `src/lib/recommendations/` — PARTIAL (5/6 files safe)
SAFE: `index.ts`, `context.ts`, `diversity.ts`, `explanations.ts`, `types.ts`
Barrel documentation, `any` audit, import-direction verification on these 5 files can proceed.
FROZEN: `scoring.ts` — imports from `scraper/providers` which has live uncommitted changes. DEFER.

### 4. `src/lib/reader/` — PARTIAL (3/4 files safe)
SAFE: `commands.ts`, `schemas.ts`, `route-guard.ts`
Import audit, `any` check, scope review documentation allowed.
FROZEN: `page-loader.ts` — imports `sanitizeArticleHtml`, `articleHtmlToReaderText` from content-pipeline.
EXECUTION of merge-into-article-library is DEFERRED (carrying `page-loader.ts` pipeline imports into merged module tightens coupling with #946). DECISION (document only) is allowed.

### 5. `src/lib/article-library/` — PARTIAL (14/16 files safe)
SAFE files (no frozen imports):
- `policy.ts`, `mapper.ts`, `listings.ts`, `listing-response.ts`
- `moderation.ts`, `review.ts`, `takedown.ts`, `tenant-integrity.ts`
- `collections/commands.ts`, `collections/default-list-policy.ts`, `collections/index.ts`
- `collections/membership.ts`, `collections/read-models.ts`, `collections/schemas.ts`

BARREL `index.ts`: documentation audit and any-check on safe re-exports is ALLOWED. Structural reorganization of exports that depend on deferred sub-modules (admin, collections/tags) is DEFERRED.

FROZEN:
- `admin.ts` — structural changes touching `getArticleProcessingSteps`/`StepRow` from `processing/state`
- `collections/tags.ts` — imports `articleHtmlToReaderText` from `content-pipeline`

---

## DEFERRED — Must wait for #946 resolution

1. `src/lib/difficulty.ts` consolidation — `articleHtmlToReaderText` from `content-pipeline` shape may change under #946.
2. `src/lib/reader/page-loader.ts` — `sanitizeArticleHtml` + `articleHtmlToReaderText` from `content-pipeline`.
3. `src/lib/recommendations/scoring.ts` — `scraper/providers` has live uncommitted changes; interface is in flux.
4. `src/lib/article-library/admin.ts` — structural refactor touching `getArticleProcessingSteps`/`StepRow`.
5. `src/lib/article-library/collections/tags.ts` — `articleHtmlToReaderText` from `content-pipeline`.
6. `reader/` merge execution (if decided) — execution carries `page-loader.ts` pipeline coupling into article-library.
7. Full `difficulty.ts` + `difficulty-version.ts` consolidation into clean module — gated on content-pipeline final boundary.

---

## Deferred-Work Tracking Requirement (non-negotiable)

**The deferred scope MUST NOT be silently dropped.** A dedicated follow-up child issue must be filed under #939 to track these 7 deferred items explicitly. Acceptance criteria from #949 that are not deliverable in the PARTIAL GO pass must be replicated verbatim in the child issue with "Blocked by #946" annotation. This is a condition of PARTIAL GO authorization.

---

## Validation Path for ALLOWED Work

```
npm run typecheck
npm test -- tests/article*.test.ts tests/reader*.test.ts tests/recommendations*.test.ts tests/leveling*.test.ts
```

Note: `tests/difficulty*.test.ts` target remains in scope only for the constants/version file; `difficulty.ts` itself deferred.

---

## Ordering

1. **Start with leveling/** — fully isolated, clean seam, fastest win
2. **difficulty-version.ts** — constants consolidation decision
3. **recommendations/ (5 safe files)** — barrel + import-direction audit; document engagement→recommendations direction as intentional
4. **article-library/ (14 safe files)** — barrel doc pass + any-removal on safe sub-modules
5. **reader/ (3 safe files)** — scope review + document merge decision (do not execute)
6. **After #946 merges** → file child issue → execute deferred 7 items in one pass

### 2026-07-12: Grammar route test mocks @/lib/reader/route-guard directly
**By:** Tank
**What:** `tests/grammar-routes.test.ts` mocks `@/lib/reader/route-guard` at the module level rather than cascading through `@/lib/article-library` + `@/lib/security/rate-limit`.
**Why:** Mocking the guard directly is the established seam (seen in `routes-api-fallbacks.test.ts`) and keeps the route test focused on the HTTP contract boundary rather than internal guard wiring already covered by `tests/reader-route-guard.test.ts`.

### 2026-07-12: Today nav placed in secondary group / More sheet on mobile

**By:** Switch
**What:** Today (`/today`) is added to NAV_ITEMS with `group: "secondary"` and `mobileTab: false`. On mobile it appears in the More sheet (overflow), not as a fifth primary tab.
**Why:** The four primary tabs (Dashboard, Browse, Study, Progress) fill the constrained mobile budget. A fifth tab would crowd smallest viewports. The More sheet is the established overflow channel per issue #1011 acceptance criteria ("choose the most evidence-backed overflow placement"). Feature-gate (`requiresFeature: "todaySession"`) threads through `ShellUser.showTodayNav` derived in the RSC layout — no server runtime config leaks to client modules.

### 2026-07-12T02-44-24: Issue #1015 admin ReadingSeries API contract and lifecycle guardrails
**By:** Trinity
**What:** Issue #1015 admin ReadingSeries API contract and lifecycle guardrails
**References:** #1015, src/lib/engagement/series.ts, src/app/api/admin/series/route.ts, src/app/api/admin/series/[id]/route.ts, src/app/api/admin/series/[id]/reorder/route.ts
**Why:** Implemented the ReadingSeries curation contract as service-first + capability-gated admin API. Service now owns list/detail/create/update/delete/reorder, slug/title/description normalization, duplicate/not-found handling, one-way lifecycle transitions (draft→active→archived; no regressions), active-enrollment delete conflict, and transactional reorder requiring identical membership. Admin routes are /api/admin/series (GET, POST), /api/admin/series/[id] (GET, PATCH, DELETE), and /api/admin/series/[id]/reorder (POST), all gated by CAPABILITIES.articlesManage and mapped via throwIfFailed/ApiError without direct Prisma in route handlers. Added focused service + route tests and updated route-group normalization for admin series dynamic IDs.

### 2026-07-11T22:31:57.145+00:00 — Epic #1008 final promotion accepted
55f2dfbb73892eaa574e2d8b087b1265ca50a97d https://github.com/huangyingting/ReadWise/pull/1032 https://github.com/huangyingting/ReadWise/actions/runs/29190298960 https://github.com/huangyingting/ReadWise/actions/runs/29190298930

### 2026-07-12 — Issue #1035 mobile UI audit reaches GO; main promotion pending

**Source:** Issue #1035 final audit/review trail

Accepted roots: safe-area, viewport-aware popover geometry, reader 100dvh, canonical high-risk wiring, and the semantic auth-boundary anchor. Child mapping is corrected and final: #1036→PR #1039→dev d4adc823; #1037→PR #1040→dev 6928c076 (PR body corrected after issue-number mix-up); #1038→PR #1041→dev 80bfc51; #1042→PR #1043→dev caffbad (v1 rejected; strict lockout preserved; final 79/79 zero-skip approval); #1044→PR #1045→dev d27cc36. Final QA is 520/520, 79/79 zero-skip/only/retry, 5/5 smoke, and 16/16 CTA matrix. Architecture final GO, Rai final GREEN, and Fact Checker final GO. Parent #1035 stays open until dev→main promotion and post-main CI.

### 2026-07-13 — Issue #1035 mobile UI audit closes after main promotion
**Source:** Promotion PR #1047 and post-main validation.
**Evidence:** PR https://github.com/huangyingting/ReadWise/pull/1047 merged dev→main at commit https://github.com/huangyingting/ReadWise/commit/a15412fae26d2b2790a6d7161603cd66c60ee951. Post-main CI https://github.com/huangyingting/ReadWise/actions/runs/29227918120 succeeded on that exact SHA; release workflow https://github.com/huangyingting/ReadWise/actions/runs/29227918111 succeeded and skipped tag/release creation by contract because the version already existed.
**State:** Final product gates remained 5/5 smoke, 79/79 high-risk zero skips, 520/520 full UI audit, and 16/16 CTA matrix. Architecture GO, Rai GREEN, and Fact Checker GO held. Parent #1035 and children #1036/#1037/#1038/#1042/#1044 are closed.
