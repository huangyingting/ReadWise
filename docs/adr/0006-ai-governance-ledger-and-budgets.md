# ADR-0006: AI invocation ledger, prompt versions, and budgets

- **Status:** Proposed
- **Date:** 2026-06-22
- **Related:** #277 (RW-019), #278 (RW-020), #279 (RW-021), #280 (RW-022), #312 (RW-054), #324 (RW-066)

## Context

AI features now generate translations, vocabulary, quizzes, tags, difficulty estimates, and speech-related content. Cost, quality, prompt drift, and safety decisions need traceability before more product intelligence features are built.

## Decision

Treat AI calls as governed product operations: record an invocation ledger, version prompts, attach model/provider metadata, enforce budgets/quotas, and add evaluation datasets for important outputs. Features must degrade gracefully when AI is unavailable or budget-limited.

## Alternatives considered

- **Only cache generated artifacts:** Saves cost, but loses prompt/model/cost history.
- **Hard-code prompts in helpers indefinitely:** Fast, but makes quality regressions hard to diagnose.
- **Centralize through a third-party gateway now:** May be useful later, but ReadWise first needs its own domain-specific ledger and evaluation shape.

## Consequences

- Cost and quality operations become auditable.
- AI helper APIs need to carry feature, prompt version, and user/tenant context where appropriate.
- Budget failures must be user-safe and should not corrupt caches.

## Follow-up work

- [ ] #277: add AI invocation ledger.
- [ ] #278: add prompt version management.
- [ ] #279: create AI evaluation datasets.
- [ ] #280: enforce AI budgets and quotas.
- [ ] #312: expose AI cost/content operations dashboards.
