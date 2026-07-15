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
