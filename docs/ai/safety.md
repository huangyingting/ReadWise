# AI safety, validation & moderation policy

This document describes the AI output-safety controls added in Epic **RW-E004**:

- **RW-023** — provider/model abstraction (see [`context-management.md`](./context-management.md)
  for the context-management half)
- **RW-024** — output validation, safe fallbacks, and a free-text moderation
  policy

The guiding principle is **fail safe, never fail loud**: every AI feature already
degrades to a graceful `fallback: true` state when the provider is unconfigured
or a call fails. The controls here extend that contract so that *malformed* or
*unsafe* model output is treated exactly like a failed call — the user always
gets a safe result and nothing bad is cached or persisted.

---

## 1. Where the controls live

| Concern | Module | Used by |
| --- | --- | --- |
| Provider abstraction & error normalization | `src/lib/ai/provider.ts`, `src/lib/ai/azure-provider.ts`, `src/lib/ai/registry.ts` | `src/lib/ai.ts` |
| Structured-output validation | `src/lib/ai/output/validators.ts` | vocabulary, quiz, tags |
| Free-text moderation | `src/lib/ai/output/moderation.ts` | tutor, grammar |
| Cache-first lifecycle (don't cache fallbacks) | `src/lib/ai-cache.ts` | all per-article AI helpers |

The public AI surface (`chatComplete` / `chatCompleteWithMeta` in `src/lib/ai.ts`)
is **unchanged** — all of this lives behind it.

---

## 2. Structured-output validation (RW-024)

Vocabulary, quiz and tag generation return **structured JSON** that is shown to
learners and cached per article. `src/lib/ai/output/validators.ts` is the single source
of truth for validating that output **before it is persisted**:

| Feature | Validator | Rules |
| --- | --- | --- |
| Vocabulary | `validateVocabulary` | each item must be an object with a non-empty `word` **and** `explanation` (`example` optional); duplicates dropped case-insensitively |
| Quiz | `validateQuiz` | each question needs a non-empty prompt, **≥ 2** distinct non-empty options, and a `correctIndex` **in range**; blank options are stripped before counting; duplicate questions dropped |
| Tags | `validateTags` | each entry must be a non-empty string that yields a non-empty slug; output is Title-Cased (short acronyms like `AI`/`US` preserved); duplicates dropped by slug |

Design rules:

- **Fence-tolerant input.** `extractJsonArray` recovers the first top-level JSON
  array even when the model wraps it in ` ```json ` fences or surrounding prose.
- **Reject, don't coerce.** Invalid items are *dropped* and counted
  (`ValidationReport.rejected`) rather than patched. A batch that ends up empty
  is treated by the caller as a generation failure.
- **Never cache a fallback.** The shared lifecycle in `src/lib/ai-cache.ts`
  returns the helper's `fallback()` result (with `fallback: true`) and writes
  **nothing** to the cache whenever `isEmpty(parsed)` is true — so a malformed or
  empty response can be replaced by a real one on a later request.

Vocabulary, quiz, and tag generation use these validators directly so each
feature follows the same strict output contract.

## 3. Free-text moderation (RW-024)

The AI **tutor** and **grammar-in-context** features exchange free text with the
model, which can't be schema-validated. `src/lib/ai/output/moderation.ts` adds a cheap,
**dependency-free, synchronous** safety net:

- `moderateText(text)` screens against a high-signal denylist across a small set
  of unambiguous, high-harm categories: `self_harm`, `sexual_minors`,
  `violence_threat`, `weapons`, `hate`.
- Patterns require **intent / instruction phrasing** (e.g. *"how to make a
  bomb"*, *"help me poison someone"*) so ordinary news/learning discussion — an
  article about a war, gun-control policy, or historical violence — is **not**
  flagged. Minimizing false positives is an explicit goal.
- When `moderateText(...).flagged` is true the caller returns
  `MODERATION_FALLBACK_MESSAGE` instead of model text and **persists nothing**.

### Policy: where moderation is applied

| Feature | Input check | Output check | On flag |
| --- | --- | --- | --- |
| Tutor (`src/lib/tutor.ts`) | the user question, before any AI call | the model answer, before persisting | return `MODERATION_FALLBACK_MESSAGE`, no DB write |
| Grammar (`src/lib/grammar.ts`) | — (input is a short selected phrase) | the model explanation, before caching | return `{ explanation: null, fallback: true }`, nothing cached |

### Optional remote moderation

A provider moderation endpoint (e.g. Azure AI Content Safety) can be layered in
later **without changing callers**: `isRemoteModerationEnabled()` gates on the
`AI_MODERATION_ENABLED` env var (off by default). The local heuristic always
runs regardless, so there is **no hard dependency** and no behavior change when
the flag is unset. This keeps the module provider-agnostic, matching the
provider abstraction in RW-023.

### Limitations

This is a **safety net, not a full moderation system**. It deliberately targets a
small set of obvious, high-harm cases to keep latency ~zero and false positives
near zero. It is not a substitute for provider-side safety systems, and it does
not attempt sentiment, PII, or nuanced policy classification.

---

## 4. Provider error normalization (RW-023)

`src/lib/ai/provider.ts` normalizes every vendor/transport failure into a typed
`AiErrorKind` so the orchestration in `src/lib/ai.ts` can make uniform retry /
fallback decisions without provider knowledge:

| Kind | Source | Retryable | Effect |
| --- | --- | --- | --- |
| `rate_limit` | HTTP 429 | yes | retry with backoff, honoring `Retry-After` |
| `server` | HTTP 5xx | yes | retry with backoff |
| `timeout` | per-attempt deadline | yes | retry with backoff |
| `network` | fetch/connection error | yes | retry with backoff |
| `auth` | HTTP 401/403 | no | fail fast → `null` |
| `bad_request` | other HTTP 4xx | no | fail fast → `null` |
| `content_filter` | provider safety refusal | no | degrade → `null` |
| `empty` | 2xx with no usable content | no | degrade → `null` |
| `aborted` | caller-initiated abort | no | stop → `null` |
| `unconfigured` | no credentials | no | graceful no-op → `null` |

In all non-success cases the public API returns `null`, preserving the
project-wide graceful-fallback convention.

---

## 5. Testing

- `tests/ai-validation.test.ts` — malformed, empty, partially-valid and valid
  structured output per feature.
- `tests/ai-moderation.test.ts` — unsafe content flagged, benign learning text
  never flagged, env gating.
- `tests/ai-provider.test.ts` — the `setAiProvider` test seam, error
  normalization, retry/exhaustion, and capability metadata.
- Existing feature tests (`tests/translation.test.ts`, `tests/quiz.test.ts`,
  `tests/tags.test.ts`, `tests/tutor.test.ts`, `tests/grammar.test.ts`) continue
  to pass unchanged — the abstraction is behavior-preserving.
