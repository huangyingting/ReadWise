# Project Context

- **Owner:** Ralph Agent
- **Project:** ReadWise
- **Stack:** Next.js, TypeScript, Prisma, SQLite default, PostgreSQL parity via Docker Compose, optional Azure OpenAI, Azure Speech, Web Push, object storage, and OpenTelemetry providers
- **Created:** 2026-07-01T10:12:10.549+00:00

ReadWise is an AI-assisted English learning reader for long-form news and educational articles. It combines a modern reader, adaptive study tools, AI-powered enrichment, content ingestion, classroom workflows, and admin/operations tooling in one Next.js app. Optional external providers must degrade gracefully when they are not configured.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

## Compressed History (2026-07-01 → 2026-07-13)

- **2026-07-01:** Roster initialized. Native coverage verifier landed (470 files ≥98%); final regrouping pass completed (4 inbox decisions merged).
- **2026-07-02:** Approved PR #874 after targeted tests, typecheck, lint, coverage (472 files ≥98%).
- **2026-07-05–07:** Release recovery verified (496 files). UI audit split (500 tests, 4 subsystem files, `@ui-audit` tag). CEFR v2 approved (42 tests, heuristic caveat). OneStopEnglish v3: rejected initial (lexical normalization + missing caveats), approved Morpheus revision (88 tests, aggregate validation).
- **2026-07-09:** Approved difficulty eval harness (Morpheus revision, NC gate, 9/9 tests). Approved hybrid v4 CEFR (54 tests, aggregate-only smoke). Approved Node 24 PR #938.
- **2026-07-10:** Cycle-1 rejected PR #955 (stale context name + PostgreSQL required but failing). Cycle-2 approved PR #955 after Tank's independent revision (exact context name verified via API, PostgreSQL removed from required checks).
- **2026-07-11:** PR #1005 cycle-1 rejected (coverage exit code 1); cycle-2 approved after Mouse fix (571 files, 110/110 routes, process exit 0). PR #1006 dev→main approved (merge 5e1b892, post-main CI green). Fact-checker correction: 4331 tests (not 3880/3902), E2E was 3/3 not 10/10. Wave 1 spawned on #1008; canonical E2E isolation discipline established.
- **2026-07-12:** PR #1021 approved (onboarding E2E, 1 passed). Wave 1 PR #1020 cycle complete (rejection + Tank revision + Morpheus merge 730bfc8). E2E runtime gate is authoritative (79/79 no-skip/only/retry); child issue numbers must be verified before publishing.
- **2026-07-13:** Deployment tested (PR #1047 → a15412f), post-main CI + release passed.

## 2026-07-14: Issue #1054 speech pipeline — Final approval and promotion

- Approved PR #1055 (6-file commit 433879a) after all ACs met: timing-unit ratios 0.9991–0.9999 prove milliseconds, 217/217 V2 rows, analyzer V2 fix correct, 45/45 tests, CI 7/7 green, browser highlights verified (headless Chromium, 10%/50%/90% correct).
- Executed PR #1055 → dev (e397f58); post-dev CI passed; promoted via PR #1056 → main (61faa85); post-main CI 29329199289 SUCCESS; issue #1054 closed.

## 2026-07-14: Issue #1057 compact V1 timing — Cycle-1 rejection + cycle-2 approval

- Cycle-1 rejected PR #1058 (Tank): barrel-export snapshot missing 2 new exports + silent invalid --target. Tank locked out; Mouse assigned cycle-2.
- Cycle-2 approved Mouse revision (b1d2f6d): barrel synchronized (+2 exports, 9/9), explicit --target error (6/6). Tank V1 frozen (36/36). All CI green.

## 2026-07-14: Issue #1060 speech-highlight-sync — Cycle 2 complete (rAF fix), delivered to main

**Actions:** 
- Cycle 1: Reviewed PR #1061 (Trinity rAF + Mouse span); approved both artifacts, requested coverage test additions (cycle-2 blocker)
- Cycle 2: Created independent branch/worktree; fixed rAF setup restoration defect; added two Strict Mode replay tests (commit f9418e5); approved by Morpheus
- Merge: PR #1063 merged to dev (447b3a4); PR #1062 merged to main (c7becda); cleanup executed (worktree removed, branches deleted)

**Outcome:** Issue closed; 4505/4505 tests pass; no blockers

**Lockout enforcement:** Trinity locked (original rAF author), Switch independent authority for both revision and review

**Status:** Complete

## 2026-07-21T14:17:00Z — Assignment lifecycle refactor PR3

- Created `tests/db/postgres-assignment-reading-sync.test.ts`: 9 PostgreSQL integration scenarios validating the full reading→assignment lifecycle against a real schema.
- Scenarios: sub-start percent short-circuit (no row created), ASSIGNED→IN_PROGRESS at start percent, →COMPLETED at `COMPLETION_THRESHOLD`, monotonic no-downgrade (never regress COMPLETED), quiz precedence (quizScore preserved; reading never clobbers it), multi-classroom fan-out (N enrolled classrooms all updated), archived-classroom exclusion (`archivedAt: null` guard verified), non-enrolled student isolation.
- Modeled exactly on `tests/db/postgres-org-classroom.test.ts` (same imports, guard pattern, `dbit_` prefix hygiene). All 9 tests fail with the benign guard message on SQLite.
- Rationale: unit tests with Prisma mocks cannot prove the actual upsert target (`assignmentId_studentId`), enrollment `where` clause, or multi-row fan-out against a real schema — only integration tests provide that gate.
- PostgreSQL Migrate/Integration CI job passed.
- Decision filed: `switch-assignment-db-test.md` (processed into `decisions.md`).
- **PR #1243** merged to `main` as **`c5a89b47`**.
