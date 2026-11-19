---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "AI provider abstraction, prompt registry and versions, safety and structured output, evaluations, and the invocation ledger with budgets."
---

# AI

Everything between a feature and a model provider. Provider, runner, registry, and budget enforcement are private; features use the public AI facade (ADR [0006](../architecture/0006-ai-governance-ledger-and-budgets.md)).

Add a document here when the change touches prompts, providers, model output validation, budgets, or evaluation datasets.

## Code ownership

- `src/lib/ai/`
- `evals/`, `src/lib/ai/evals/`
- `scripts/translation-prompt-lab/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [AI context management & long-text chunking](./context-management.md) | design | current | Documents AI provider abstraction, context construction, chunking, cache keys, and fallback boundaries. Captures current long-context handling, cache/version behavior, prompt/privacy limits, and graceful degradation rules. |
| [AI evaluation datasets & regression tests](./evaluations.md) | testing | current | Documents offline/live AI evaluation harnesses, datasets, and regression boundaries. Captures current eval dataset structure, runner behavior, deterministic checks, live-provider safeguards, and output expectations. |
| [AI governance ledger, budgets, and usage reporting](./governance-ledger.md) | policy | current | Documents AI invocation ledger, cost estimates, budgets, retention, and admin usage reporting. Captures current metadata-only ledger writes, quota enforcement, cost configuration, privacy boundaries, and reporting flows. |
| [AI prompt templates & version management](./prompts.md) | design | current | Documents prompt registry, prompt-version ownership, and rebuild/backfill implications. Captures current prompt labels, versioned cache behavior, prompt privacy rules, and regeneration workflow. |
| [Provider-DB translation prompt lab](./provider-db-translation-prompts.md) | reference | current | Category-aware Simplified Chinese translation prompts for prisma/provider-dbs articles: the offline prompt lab, evaluation methodology, and current recommendation. Prompts only — no batch translation has been run against provider-dbs yet. |
| [AI safety, validation & moderation policy](./safety.md) | design | current | Documents AI safety boundaries across structured validation, moderation, provider errors, and fallbacks. Captures current validator usage, safe output handling, moderation posture, provider-error normalization, and privacy constraints. |

<!-- END GENERATED: docs-index -->
