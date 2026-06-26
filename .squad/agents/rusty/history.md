# Project Context

- **Owner:** Yingting Huang
- **Project:** ReadWise — AI-assisted English learning reader with a modern Studio redesign.
- **Stack:** Next.js 15 App Router, React 19, Prisma/SQLite, NextAuth database sessions, Azure OpenAI/Speech, Playwright.
- **Created:** 2026-06-19

## Learnings

<!-- Condensed by Scribe on 2026-06-20 after history exceeded the 15KB summarization gate. Full review details remain in decisions.md and session/orchestration logs. -->

### 2026-06-19 — Review posture across M2–M16

Rusty reviewed the redesign/rich-feature work with a consistent focus on security, IDOR, XSS, a11y, and contract preservation:

- **M2–M9:** approved app shell, listings, reader, gamification, onboarding, admin polish, and command palette with nits/fixes around accent semantics, listing DOM hooks, reader lifecycle, SM-2 correctness, reduced motion, and ARIA.
- **M10 Bookmarks/Lists:** no IDOR; ownership checks verified across routes; listing progress hooks preserved; six deferrable nits.
- **M11 Highlights/Notes:** no sanitize bypass, no XSS/IDOR; fixes required for splitText crash, popover layout thrash, and note-cap mismatch.
- **M12 Tutor:** no XSS/IDOR; safe markdown token objects; reduced-motion CSS typo fixed before land.
- **M13 Sentence Translation:** translate surface state and stale-request guards correct; no `dangerouslySetInnerHTML`; fallback never cached.
- **M14 Quiz Mastery:** grading unchanged; record-once guard correct; server-derived score; IDOR clean.
- **M15 Personalized Feed:** card DOM contract intact, batched endpoint/no N+1, completed articles excluded, no IDOR.
- **M16 Pronunciation:** Azure key never sent client-side, no audio stored, IDOR clean, non-color cues pass; transient token failure fixed.

### 2026-06-20 — System review severity lesson

After the #54–#78 system review batch, Rusty/Ralph corrected the triage model: before filing P0/P1 reader issues as Critical, verify the root cause with source/manual behavior. The #48 double-render bug can create false DOM symptoms, so #54, #55, #56, and #57 required correction after the initial batch.

### 2026-06-20 — Ralph work-all-issues scaling spike

Rusty closed #45 as a spike by posting a five-phase scaling plan to the issue. This keeps broad scaling architecture as a staged roadmap instead of mixing major infrastructure changes into unrelated fix waves.

Final cumulative gate after all six Ralph waves: typecheck 0, lint 0, tests 411/411, build passes.

### Cross-agent lessons

- Sequential single-owner waves avoid main-branch git conflicts when agents are committing directly to `main`.
- Root-cause high-severity reader/a11y reports before filing or escalating them as Critical; double-render/hydration bugs can masquerade as many independent symptoms.
- Scaling work should be phased from measurement and low-risk DB/cache wins toward queues, workers, observability, and larger architecture changes.
- Security reviews should verify exploitability and ownership scope before raising severity; high-confidence findings beat broad speculative reports.


### 2026-06-20 — Build-artifact triage lesson

Before filing build failures as product bugs, verify they are not concurrent-dev-server or dirty `.next` artifacts. In review 2, the flagged build failure was artifact-only and a clean build passed, so the right follow-up was a reliability spike/comment rather than a confirmed product regression.


### 2026-06-20 — PR-flow divergence lesson

PR flow for this repo: branch from `origin/main`, squash-merge, then reset local `main` to `origin/main` after each merge to avoid divergence before starting the next branch.


### 2026-06-21 — Product backlog from competitor research

Review 3 surfaced a learner-focused product backlog informed by competitor and internet pain-point research. Many issues #105–#126 are feature gaps marked `go:needs-research`, so future triage should separate quick UX wins from larger product/architecture decisions.


## 2026-06-21 — Cross-agent lessons from #105–#126 merge wave
- When CI is unavailable, the coordinator gates merges via local typecheck/lint/test/clean-build before squash-merge.


## 2026-06-25 — Codebase Quality Audit (10-pass ARCHITECTURE sweep)

Rusty performed an exhaustive 10-pass architecture audit of ReadWise as part of a five-domain quality review requested by Yingting Huang. Findings documented in `files/findings-architecture.md` (15 findings: ARCH-1–ARCH-15).

Key architecture findings: AI provider call-site sprawl, lib dependency inversion gaps, oversized modules needing splitting, redundant compat layers for superseded payload shapes, missing subsystem boundaries (scraper/storage/speech/AI), extensibility bottlenecks, ADR coverage gaps.

After Rusty-1 (opus-4.8) consolidation of all 79 cross-domain findings into 15 issues: **Rusty owns issue #613** (lib dependency inversion — Phase 1 Foundations) on epic #610.

Epic #610 + child issues #611–#625 created on huangyingting/ReadWise. No source code modified (analysis only).

## 2026-06-26 — Round-2 Codebase Quality Audit (10-pass ARCHITECTURE sweep)

Rusty-2 performed a second-wave 10-pass architecture audit as a follow-up to epic #610, targeting NEW, non-overlapping issues. Read `files/findings-architecture.md` and issues #611–#625 first. Focused on config/env handling, sensitive-data redaction, test seams, ADR coverage, and subsystem contract enforcement. Findings documented in `files/findings-architecture-r2.md` (11 findings: ARCH2-1–ARCH2-11).

Standout cross-domain finding: ARCH2-2 (divergent sensitive-key redaction) was independently corroborated by Livingston (BE2-1) — real privacy leak and AGENTS.md violation. Also corroborated: ARCH2-3 (runtime-config env scattering) with BE2-2/3.

Rusty-3 (opus-4.8) consolidated all 67 round-2 findings into 13 issues. **Rusty owns issues #627** (p0 — unified sensitive-key redaction primitive, Phase 1) and **#632** (ADR and subsystem contract enforcement, Phase 1) on epic #626, follow-up to #610.

No source code modified (analysis only).
