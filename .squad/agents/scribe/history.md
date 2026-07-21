# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL via Docker, optional Azure providers (OpenAI, Speech, Push, Storage), OpenTelemetry
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise: AI-assisted English learning reader. Scribe maintains decisions, logs, and cross-agent context.

## Summary

Scribe logs session decisions, maintains decision ledger (decisions.md with archival gates), manages cross-agent history, and coordinates team ceremony records. All work persisted via state tools; no git commits or code mutations.

## Key Sessions (High-Level Summary)

**2026-07-01 Initialization:** Squad roster created (Morpheus, Trinity, Tank, Mouse, Switch, Scribe, Ralph, Rai). Routing/charter config finalized.

**2026-07-02–07-05 Initial Sprints:** Multiple PR decisions merged (coverage strategy #874, release gate recovery, semantic UI audit split). No blocking issues.

**2026-07-07 Difficulty Calibration:** CEFR/Lexile-like calibration work logged. Multiple foundational decisions recorded (v2 heuristic status, OneStopEnglish v3 ordinal anchors, evaluation harness aggregate-only scope). All recorded in decisions.md without committing raw calibration text.

**2026-07-09–10 Architecture Cycles:** Difficulty eval harness approved with NC-licensed caveat. CEFR hybrid v4 calibration accepted. Multiple PR retrospectives (PR #937, PR #965, PR #955) completed with cycle-1/cycle-2 feedback loops.

**2026-07-10 Epic Completion:** Epic #1008 finalization. E2E discovery mandate confirmed, isolated ports/DB required for Playwright sequential testing, formal-review comments as verdict mechanism, reviewer lockout chains preserved.

**2026-07-11–13 Mobile UI & Release:** Issue #1035 mobile UI audit reaches GO → main promotion → closed. Architecture sound, coverage passing.

**2026-07-14 Major Sprints (Current):**
- **Issue #1054 Speech Audio:** 217-row generation with 937,273 word timings. Morpheus design review → Mouse generation (0.9991 ratio) → Tank validation (0.999 ratio) → Trinity browser validation (1.0009 ratio) → Switch merge review → Morpheus main promotion (commit 61faa85). All acceptance criteria met: milliseconds confirmed, 99.96% boundary coverage, monotonic, UTF-16 spans. CLOSED.

- **Issue #1057 Compact V1 Timing Storage:** Morpheus design review (ratified {version:1,words[],startMs[],endMs[]} format with parser gate, V2 frozen, no schema migration). Tank implementation → Switch cycle-1 rejection (barrel export test gap, Tank locked out) → Mouse cycle-2 independent revision (export fix + --target error) → Switch re-approval → Morpheus main promotion (commit 04d9d7b). Contract verified: V1 shape, parser ordering, V2 boundaries frozen, backward compat preserved. CLOSED.

- **Issue #1060 Speech/Highlight Desync:** Root-cause spike completed. 8-layer analysis (Azure, MP3, units, spans, tokens, silence, browser, CSS). Evidence-gated fix sequencing: (1) Mouse data analysis disproved MP3 offset, confirmed span completeness secondary; (2) Trinity browser measurement proved timeupdate cadence ~266ms primary lag source, rAF counterfactual ~22ms confirms 90% reduction achievable; (3) Trinity primary rAF-clock fix (usePlaybackClock, 98% latency reduction: 265.6ms→16.7ms p50, 265.7ms→17.9ms p90; expected onset 140ms→8ms p50, 200ms→15ms p90); (4) Mouse secondary span-recovery (151→217 complete spans via two-pass batch enrichment, 937,270/937,270 normalized); (5) Combined PR #1061 (Trinity + Mouse, 54/54 tests, all criteria met); (6) Cycle-1 rejection: Switch REQUEST_CHANGES (coverage gap in timing-migration.ts: 96.05% < 98%, 3 branches missing); (7) Cycle-2 revision: Tank edge-case tests (parse-null, zero-duration, Prisma error), coverage now 100%. READY for Switch cycle-2 re-approval.

## Decision Ledger Stats

- Total active decisions (2026-07-15): 45 entries
- Archive trigger: >= 51,200 bytes
- Archive age gate: >7 days (2026-07-07 entries archived on 2026-07-15)
- Last archive: 4 decisions from 2026-07-07 (5,165 bytes archived)
- Current size: ~75 KB (post-archive)

## Governance Observations

- Reviewer lockout protocol enforced consistently across cycles
- Evidence-gated fix sequencing proved effective (issue #1060)
- Two-move feature-gate extraction pattern (tank/switch retrospective on #965)
- Measurement-cascade protocol clarified (coverage gate exposes pre-existing untested branches when refactors call unmeasured modules)
- No committed secrets, private content, or article text in logs/state

## Scribe Responsibilities Met

✓ Decision archival (age/size gates enforced)
✓ Inbox drain (no outstanding entries)
✓ Cross-agent history propagation
✓ Orchestration/session logging per agent
✓ No repository mutations or commits
✓ No raw secrets, article content, or private data persisted
## 2026-07-10T10:31:49+00:00 — Retrospective ceremony initiated (PR #965 rejection, Tank lockout, Switch independent revision)

**Ceremony manifest:**
- Ralph requested focused retrospective after PR #965 rejection
- Morpheus facilitates retrospective (lead)
- Tank excluded by reviewer lockout (blocker enforcement)
- Switch is independent revision owner (permitted to revise without Tank approval)
- Scribe logs ceremony, decides merged decisions only

**Ceremony record:**
- Ceremony start logged at 2026-07-10T10:31:49+00:00
- Agent roster status: Morpheus (Lead), Tank (LOCKED OUT), Switch (Independent Reviser), Ralph (Monitor), Scribe (Logger)
- Pending: Morpheus retrospective analysis, Switch independent revision, decision inbox review for safe merges
- To follow: ceremony completion summary for coordinator review only



**Inbox review (safe completed merges):**
- Decision: `tank-bootstrap-merge-complete.md` — COMPLETED with evidence (PRs #955, #957 merged to dev, SHAs recorded, required checks 4/4 green on #957, post-merge CI initiated)
- Decision: `Morpheus-repository-wide-refactor-program-dev-first-staged-.md` — APPROVED (6-wave dependency-aware program with concurrency rules, platform bootstrap prerequisite satisfied by tank-bootstrap-merge-complete)
- Decision: `Switch-pr-955-retrospective-branch-protection-configurati.md` — APPROVED (post-failure fact synthesis, process changes documented, no fabricated pending outcomes)
- Decision: `switch-pr955-review-request-changes.md` — APPROVED (blocker documentation, revision owner assignment to Tank, Morpheus lockout enforced)

**Merge eligibility assessment:**
All four recent decisions are complete, evidence-backed, and coordination-complete. No pending outcomes fabricated. Safe for coordinator review and merged inbox → decisions.md.

**Ceremony completion:**
- Morpheus retrospective facilitation: approved, evidence-documented
- Tank lockout: enforced (cannot own revision, assigned as independent owner on PR #955 follow-up)
- Switch independent revision role: confirmed (approved retrospective synthesis, not author of bootstrap work)
- Decision inbox → decisions.md merge: ready for coordinator

**Ceremony end:** 2026-07-10T10:32:15+00:00 (silent logger, no user interaction, summary for coordinator only)


## 2026-07-10T10:48:29Z — PR #965 Cycle-2 Rejection: Focused Retrospective (Ralph initiated)

**Ceremony context:**
- Ralph requested Morpheus-facilitated retrospective on PR #965 cycle-2 rejection
- Tank locked out per REQUEST_CHANGES protocol; Switch revision owner for cycle 3; Mouse fallback for cycle 4+
- Scribe logs only, no product/git/PR changes
- Coordinator summary follows

### Cycle Progression Root Cause Analysis

**Cycle 1: Morpheus initial review (2026-07-10T10:30:41Z) — REQUEST_CHANGES (Architecture)**
- **Issue:** Six identical `TODAY_ROUTE_FEATURE_GATE` declarations across route files
- **Root cause:** Tank completed abstraction extraction (sems imported) but not configuration extraction (policy objects still duplicated)
- **Pattern violation:** Feature-gate extractions require two moves: (1) extract the helper function, (2) extract the configuration object to canonical domain module
- **Fix required:** Extract `TODAY_THROWING_GATE` to `src/lib/engagement/today-session/feature-gate.ts` and import into all six routes
- **Why it matters:** Duplicated policy objects create maintenance burden; defeats single-source-of-truth principle

**Cycle 2: Switch revision (2026-07-10T10:39:40Z) — REQUEST_CHANGES (Coverage measurement cascade)**
- **Issue:** CI coverage gate failure: `reflection/route.ts` at 95.45% (threshold 98%)
- **Root cause:** Switch correctly fixed the architecture defect, but new test file (`today-rollout-disabled.test.ts`) imports the reflection route for the first time, causing it to enter coverage measurement set. Test exercises happy path + disabled path but not error-result branch (`!result.ok` lines 40–41).
- **Cascade mechanics:** This module was unmeasured on `dev` before (reflection route not imported by any test); test harness now sees it; pre-existing error branch now visible as uncovered
- **Nature of defect:** NOT a code-quality defect. NOT an implementation problem. Pure measurement-cascade artifact: refactoring called unmeasured module; module now measured; pre-existing untested branch exposed by CI gate (working as designed).
- **Fix required:** Surgical 1–2 test cases for `recordTodayReflection → { ok: false, … }` error path
- **Why it matters:** Captures tension in strict coverage gates—they protect against untested error paths (good), but can cascade measurement to expose false blocks when refactors call unmeasured modules (procedurally frustrating)

### Strategic Pattern Extraction: Two-Move Feature-Gate Extractions

| Move | Scope | Owner verification |
|---|---|---|
| **Move 1** | Extract helper function (`defineFeatureGate`, `enforceFeatureGate`) | Typecheck clean, no barrel cycle |
| **Move 2** | Extract policy configuration object to canonical domain module | No duplication; all callers import shared object |

**Cycle 1 anti-pattern:** ✅ Move 1, ❌ Move 2 → Duplication anti-pattern
**Cycle 2 correction:** ✅ Move 1 + Move 2 → Architecturally sound, but measurement cascade exposed pre-existing coverage gap

### Assessment: Is Cycle-2 Rejection a Blocker?

| Dimension | Status | Blocker? |
|---|---|---|
| Architecture (canonical gate) | ✅ Correct | ✅ NO |
| Implementation (behavior) | ✅ Preserved | ✅ NO |
| Route ordering (auth → gate → parse → DB) | ✅ Correct | ✅ NO |
| Dependency direction | ✅ No reverse | ✅ NO |
| Barrel cycle | ✅ No risk | ✅ NO |
| TypeCheck / Lint | ✅ Pass | ✅ NO |
| **Coverage measurement cascade** | ❌ Measurement gap | ❌ **YES** (fixable with 1–2 tests) |

**Conclusion:** Cycle-2 rejection is not a blocker on design or behavior. It's a measurement-cascade coverage gap that a surgical test addition (1–2 cases for error path) will resolve. All architectural corrections from cycle 1 are sound.

### Cycle 3 Readiness (Switch revision)

**Switch's revision scope:**
1. Add 1–2 test cases in `tests/today-rollout-disabled.test.ts` exercising `recordTodayReflection → { ok: false, … }` to cover lines 40–41
2. Verify coverage passes locally: `npm run test:coverage`
3. Push; all four protected CI checks should pass

**If cycle 3 fails:**
- Tank remains locked out (author, REQUEST_CHANGES protocol)
- Switch remains locked out (if cycle 3 introduces new issues)
- **Mouse becomes cycle-4 revision owner** per manifest

### Ceremony Completion

- Retrospective analysis: COMPLETE, decision points extracted
- Cycle-1 learning recorded: Two-move extraction pattern
- Cycle-2 learning recorded: Measurement cascade protocol
- Cycle-3 readiness: Switch revision scope clear, fallback path defined
- No product/git/PR changes made (log-only mandate honored)

**Coordinator summary:** PR #965 architecture is sound; cycle-2 rejection is measurement-cascade (surgical fix). Switch revision ready for cycle 3. No blocker on merge design—only test coverage gap to resolve.

Ceremony end: 2026-07-10T10:48:29Z
- 2026-07-12T02:41:59.148+00:00 — Inbox drains must process every decision key; archive gates now depend on exact UTF-8 byte counts and age thresholds before/after merge.
- 2026-07-11T22:31:57.145+00:00 — Epic #1008 finalization reinforced that canonical E2E discovery is mandatory, isolated ports/DB/.next are required for sequential local Playwright, formal-review comments are the accepted verdict mechanism under shared identity, and reviewer lockout chains must be preserved.

- 2026-07-11T22:31:57.145+00:00 — Final promotion closure stayed under the decisions archive gate by keeping the ledger entry concise and avoiding raw CI output.
- 2026-07-13T06:09:56.157+00:00 — Closed #1035 after PR #1047 merged to main at `a15412fae26d2b2790a6d7161603cd66c60ee951`; post-main CI 29227918120 and release 29227918111 passed, and identity was updated to complete.

- 2026-07-14T08:15:46.165+00:00 — Logged Mouse issue #1054 generation phase completion: 217/217 ArticleSpeech V2 rows populated, 217/217 MP3s persisted (gitignored), empirical timing verified (318.91s batch vs 319.21s MP3, delta 0.30s within tolerance, ratio 0.9991 within [0.90,1.15]), analyzer V2 parser fixed, docs comments corrected (safe, no secrets), 63 tests passing, PR #1055 opened targeting dev. Wrote orchestration and session logs with empirical evidence. No article text/words/titles recorded; only timing statistics and aggregate counts persisted. No gate violation; decisions.md 50,591 bytes, archive.md 238,473 bytes, inbox 0 files.

- 2026-07-14T08:15:46.165+00:00 — Logged Tank issue #1054 backend validation phase: 217/217 ArticleSpeech rows cached without re-synthesis, sample MP3 verified (1,276,848 bytes, MPEG header, audio/mpeg, content-length match), V2 timing/plainText delivery confirmed, timing/audio ratio 0.999, cache-control private semantics, endpoint routing validated (both /audio and /timing use same row), 217/217 storage key resolution, auth/404/degradation paths tested, range requests not implemented (no regression), 44 tests passing, lint/diff-check/typecheck clean. Wrote orchestration and session logs with empirical MP3 byte/MIME evidence. No article content/IDs/secrets recorded; only aggregate storage counts. No gate violation.

- 2026-07-14T08:15:46.165+00:00 — Logged Trinity issue #1054 browser validation phase: loaded Reader page with real MP3 from dev.db, verified audio playback (319.212s browser vs 318.913s payload, delta 0.299s, ratio 1.0009 within tolerance, consistent with prior validations 0.9991→0.999), confirmed CSS highlight at 10%/50%/90% seeks matched UTF-16 spans, verified player controls (play/pause/resume/seek/mini-player/auto-scroll) synchronized, zero console/network errors, fallback token alignment covered, 18 tests passing, diff-check clean, no code changes. Wrote orchestration and browser validation logs with empirical timing evidence. No article content/words/spans/secrets recorded; only timing ratios/control states persisted. All four issue #1054 phases (Morpheus + Mouse + Tank + Trinity) now complete and validated.
