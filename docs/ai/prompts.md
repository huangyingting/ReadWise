# AI prompt templates & version management

This document describes the prompt template / version registry added in Epic
**RW-E004 / RW-020**. It builds on the provider abstraction (RW-023), the AI
ledger (`src/lib/ai-ledger.ts`, which already carries a `promptVersion` column),
and the backfill/rebuild orchestration (`src/lib/processing/backfill.ts`). For output
validation/moderation see [`safety.md`](./safety.md); for context/chunking
see [`context-management.md`](./context-management.md); for the evaluation harness see
[`evaluations.md`](./evaluations.md).

---

## 1. Why a registry

Prompt text used to live **inline** inside each AI feature helper
(`translation.ts`, `vocabulary.ts`, …). That made two things impossible:

1. Knowing **which prompt revision** produced a piece of cached content.
2. Telling whether a quality change came from a **prompt edit** vs. a model or
   parsing change.

`src/lib/ai/prompts/` is now the single, code-based **source of truth** for
every feature's prompt. Per feature it defines a `PromptTemplate`:

```ts
type PromptTemplate<Vars> = {
  feature: string;                 // matches the ledger/log feature label
  version: string;                 // stable label, e.g. "translation/v1"
  active: boolean;                 // the active version for this feature
  modelParams: { maxOutputTokens?; temperature? };
  description: string;             // human-readable, for docs/change tracking
  render: (vars: Vars) => { role; content }[];  // pure → chat messages
};
```

### Storage decision: code, not database

Prompts live in **code (versioned files)**, not the database. For the current
stage this keeps prompts:

- **reviewable** in PRs (a prompt change is a normal diff + code review),
- **diffable** over time and tied to git history,
- free of an admin-editing UI / permission / audit surface.

A database-editable prompt store can be layered on later if product needs it, but
it would require admin permissions + audit logging (per the RW-020 notes) and is
intentionally out of scope here.

---

## 2. Public API

| Export | Purpose |
| --- | --- |
| `PROMPT_TEMPLATES` | The registry: active template per feature. |
| `renderPrompt(feature, vars)` | Type-safe render → `{ role, content }[]` chat messages. |
| `activePromptVersion(feature)` | The active version label (e.g. `"quiz/v1"`); falls back to `<feature>/v1` for unregistered features. |
| `promptModelParams(feature)` | The active template's model params (`{}` if none). |
| `featuresWithStalePrompts(producedVersions)` | Features whose recorded prompt version no longer matches the active one (rebuild trigger). |
| `PROMPT_FEATURES` / `isPromptFeature(x)` | The registered feature keys + a type guard. |
| `TARGET_VOCABULARY_WORDS` / `TARGET_QUIZ_QUESTIONS` / `TARGET_TAGS` | Shared generation targets so the prompt text and the helpers that slice/validate against the count never drift. |

`src/lib/ai/prompts/` imports **nothing** from server-only modules (it is a pure,
dependency-free registry), so it
can be imported anywhere — feature helpers, the chunking layer, and the eval
harness — without circular-dependency risk.

---

## 3. Active prompt versions

Behaviour was preserved during migration: each template reproduces the **exact
wording** the helper previously embedded, and keeps its existing `<feature>/v1`
label, so cached derived content and existing tests stay valid.

| Feature | Active version | `maxOutputTokens` | Helper |
| --- | --- | --- | --- |
| `translation` | `translation/v1` | provider default | `src/lib/translation.ts` |
| `vocabulary` | `vocabulary/v1` | provider default | `src/lib/vocabulary.ts` |
| `quiz` | `quiz/v1` | provider default | `src/lib/quiz.ts` |
| `tags` | `tags/v1` | provider default | `src/lib/article-library/collections/index.ts` |
| `difficulty` | `difficulty/v1` | 16 | `src/lib/difficulty.ts` |
| `grammar` | `grammar/v1` | 256 | `src/lib/grammar.ts` |
| `tutor` | `tutor/v1` | 2048 | `src/lib/tutor.ts` |
| `sentence-translation` | `sentence-translation/v1` | 256 | `src/lib/sentence-translation.ts` |

---

## 4. How feature helpers use it

Each helper renders its messages from the registry instead of building strings
inline, and threads the active version + model params into the AI call so the
ledger records the prompt that produced the output:

```ts
import { renderPrompt, activePromptVersion, promptModelParams } from "@/lib/ai/prompts";

const messages = renderPrompt("difficulty", { title, source });
const result = await chatCompleteWithMeta(messages, {
  feature: "difficulty",
  promptVersion: activePromptVersion("difficulty"),
  maxOutputTokens: promptModelParams("difficulty").maxOutputTokens,
});
```

The public API and output of every helper are unchanged — only the *source* of
the prompt text moved.

### Cache-key linkage (no schema change)

`src/lib/ai/chunking.ts` derives `promptVersionFor(feature)` from the registry
(`activePromptVersion`). The content cache key
(`aiContentCacheKey`) already includes the prompt version, so cached derived
content is implicitly partitioned by prompt version, and the AI ledger row
records the exact `promptVersion` that produced each invocation. This is the
primary, cheapest linkage and needs **no Prisma schema change**.

---

## 5. Prompt changes → targeted rebuild/backfill

Bumping a feature's active prompt is the trigger for a targeted rebuild:

1. Edit the template's text **and** bump its `version` (e.g.
   `quiz/v1` → `quiz/v2`) and set the old one inactive (or replace it). The
   version label is what the ledger records, so it must change when wording
   changes.
2. Identify stale content. Feed the previously-recorded versions (e.g. the
   distinct `promptVersion` values per feature from the AI ledger) through
   `featuresWithStalePrompts(...)`:

   ```ts
  import { featuresWithStalePrompts } from "@/lib/ai/prompts";
  import { runBackfill } from "@/lib/processing/backfill";

   const stale = featuresWithStalePrompts({ quiz: "quiz/v1" /* recorded */ });
   // → ["quiz"] once the active version is "quiz/v2"

   if (stale.length > 0) {
     await runBackfill({ features: stale, mode: "rebuild", reason: "prompt-bump" });
   }
   ```

   A feature absent from the map (or with a `null`/`undefined` value) is treated
   as "unknown provenance" and is **not** reported as stale.

3. The backfill rebuilds only the affected feature's derived content; the
   cache-first `getOrCreate*` helpers regenerate it with the new prompt and
   record the new version.

---

## 6. Tests

`tests/prompts.test.ts` covers, with no mocks (the registry is pure):

- every feature resolves the expected active version and is `active`,
- `renderPrompt` produces the right message structure (system + user) and the
  expected wording / interpolated title/source/level per feature,
- `promptModelParams` returns the documented budgets,
- `featuresWithStalePrompts` flags only changed versions and is null-safe,
- unregistered features fall back to `<feature>/v1`.

Behaviour-preservation is additionally guarded by the existing
`tests/translation.test.ts`, `tests/tutor.test.ts` (CEFR level appears in the
system prompt), and `tests/ai-chunking.test.ts` (cache key is prefixed by
`promptVersionFor("vocabulary")`).
