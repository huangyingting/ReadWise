---
type: "testing"
status: "current"
last_updated: "2026-07-01"
description: "Documents offline/live AI evaluation harnesses, datasets, and regression boundaries. Captures current eval dataset structure, runner behavior, deterministic checks, live-provider safeguards, and output expectations."
---

# AI evaluation datasets & regression tests

This document describes the AI evaluation harness added in Epic
**RW-E004 / RW-021**. It catches prompt/model/parsing regressions in the AI
features by running each feature's real parsers/validators against small curated
datasets of representative inputs + expected **invariants**. See
[`prompts.md`](./prompts.md) for the prompt registry the live mode renders
through, and [`safety.md`](./safety.md) for the validators the checks reuse.

---

## 1. What it evaluates (and what it does NOT)

The harness checks **semantic properties / invariants**, not exact provider
output. That makes it robust to harmless wording differences between model runs
while still catching real breakage. Examples:

| Feature | Properties checked |
| --- | --- |
| `translation` | non-empty, no markdown fences, **preserves paragraph count** |
| `vocabulary` | parses ≥ N items, every item has `word` + `explanation`, no duplicate words |
| `quiz` | parses ≥ N items, **every question has ≥ 2 options**, **`correctIndex` is in range** |
| `difficulty` | output is a **valid CEFR token**; optionally matches an expected band |
| `grammar` | non-empty, no HTML, not flagged by moderation |
| `tutor` | non-empty, no HTML, not flagged; optionally **grounded** (must include given terms) |
| `safety` | no prompt-disclosure, no instruction-echo, not flagged; optionally includes expected safe terms |

Each major AI feature has **≥ 1 dataset** under `evals/` (`translation.json`,
`vocabulary.json`, `quiz.json`, `difficulty.json`, `grammar.json`, `tutor.json`,
`safety.json`).

---

## 2. Modes

The harness (`src/lib/ai/evals/`) runs in two modes:

### Offline (default — deterministic, CI)

Each dataset case carries a representative `modelOutput`, which is fed through
the **real** feature parsers/validators (`validateVocabulary`, `validateQuiz`,
`parseLevel`, `moderateText`, the paragraph/HTML/fence checks). **No provider
credentials, DB, or network are required**, so prompt/model/parsing regressions
are caught in CI without secrets. This is what `tests/ai-eval.test.ts` runs.

### Live (optional — staging/manual)

With `--live`, the active prompt for each case is rendered via the
[prompt registry](./prompts.md) and sent to the configured provider; the
**same** property checks run against the live output. Live mode lazily imports
`@/lib/ai`, so offline/CI never pulls the provider stack.

---

## 3. Running it

```bash
# Offline deterministic run over every evals/*.json dataset
npm run eval

# Only one feature dataset
npm run eval -- --feature quiz

# Machine-readable JSON report on stdout
npm run eval -- --json

# Write the JSON report to a file (for run-over-run comparison)
npm run eval -- --out eval-report.json

# Live provider-backed run (needs AZURE_OPENAI_* creds; staging/manual)
npm run eval -- --live
```

The CLI exits **non-zero** when any property fails, so it can gate manual/staging
checks too. Under the hood `npm run eval` uses the same TS-CLI harness as the
other scripts (`node --import ./scripts/register-ts.mjs scripts/eval.ts`).

---

## 4. Reading the report

The console output prints, per feature, the passed/checked property count and a
score, then overall totals. The JSON report (`--json` / `--out`) is fully
serializable and comparable across runs:

```jsonc
{
  "mode": "offline",
  "generatedAt": "2026-06-23T04:39:02.000Z",
  "promptVersions": { "quiz": "quiz/v1", "translation": "translation/v1", ... },
  "features": [
    {
      "feature": "quiz",
      "caseCount": 2,
      "casesPassed": 2,
      "propertiesChecked": 6,
      "propertiesPassed": 6,
      "score": 1,
      "cases": [ { "caseName": "...", "properties": [ { "name": "...", "passed": true } ] } ]
    }
  ],
  "totals": { "caseCount": 12, "casesPassed": 12, "propertiesChecked": 36, "propertiesPassed": 36, "score": 1 }
}
```

Key fields:

- `totals.score` — overall `propertiesPassed / propertiesChecked` in `[0, 1]`.
- `promptVersions` — the active prompt version per feature **at the time of the
  run**, so a report is tied to the exact prompts it exercised.
- `generatedAt` — ISO timestamp.

### Comparing runs over time

Persist the JSON reports (e.g. `--out eval-report.json`) and diff them:

```bash
npm run eval -- --json > before.json
# … change a prompt / model / parser …
npm run eval -- --json > after.json
diff <(jq '{score: .totals.score, promptVersions}' before.json) \
     <(jq '{score: .totals.score, promptVersions}' after.json)
```

A drop in `totals.score`, a feature whose `score` regressed, or a changed
`promptVersions` entry tells you a prompt/model/parser change moved quality. In
**live** mode, run the same datasets before/after a prompt bump (with
`promptVersions` recording which prompt produced each run) to quantify the
effect of the change.

---

## 5. CI regression test

`tests/ai-eval.test.ts` runs the **offline** evaluation deterministically and
asserts:

- every evaluable feature has ≥ 1 curated dataset,
- all curated datasets pass **every** property (`totals.score === 1`,
  `collectFailures(report)` is empty),
- the report records the active prompt version per feature,
- the checks **have teeth**: a deliberately-broken output (a quiz with one
  option and an out-of-range `correctIndex`) scores `< 1`, and a missing
  `modelOutput` is reported as a failed property,
- live mode routes through an injected model caller (no real provider in CI).

Because it needs no credentials, DB, or network, it runs in CI on every change
and fails fast on any AI regression.

---

## 6. Adding a dataset / case

1. Add a JSON file under `evals/` (or a case to an existing one):

   ```jsonc
   {
     "feature": "quiz",
     "description": "...",
     "cases": [
       {
         "name": "short-article",
         "input": { "title": "…", "source": "…" },
         "modelOutput": "[{\"question\":\"…\",\"options\":[\"a\",\"b\"],\"correctIndex\":0}]",
         "expect": { "minItems": 1 }
       }
     ]
   }
   ```

2. `input` feeds the LIVE prompt render; `modelOutput` is the OFFLINE canned
   output fed through the parsers; `expect` carries per-feature expectations
   (e.g. `minItems`, `level`, `mustInclude`).
3. Only features with a registered evaluator in `EVALUATORS` can be evaluated —
   add one there if you introduce a new feature.
4. Dataset inputs must be invented or anonymised — never paste real user content,
   prompt/response logs, or article bodies from production.  See the
   [AI evaluation datasets section](../platform/test-data-governance.md#15-ai-evaluation-datasets)
   of the test data governance guide for the privacy rules that apply to `evals/`.

---

## 7. Safety regression dataset (`evals/safety.json`)

`evals/safety.json` (feature `safety`) holds prompt-injection and safety
invariant cases added in issue **#736**. Each case's `modelOutput` is a
representative **safe** response — what a well-behaved model should produce
when the input-safety layer has correctly neutralized or delimited an injection
attempt.

### Invariants enforced by the `safety` evaluator

| Property | What it checks |
| --- | --- |
| `non-empty` | Response is not blank |
| `no-html` | Response contains no HTML/script tags |
| `not-flagged` | Content moderator does not flag the response |
| `no-leakage:<label>` | Response does not echo prompt-disclosure or override phrasing |
| `includes-expected` | Response contains learner-relevant terms from `expect.mustInclude` |

### Adding a safety case

```jsonc
{
  "name": "my-injection-variant",
  "input": {
    "category": "chatml-delimiter",          // label for audit/reporting
    "description": "Brief description.",
    "sanitizedInput": "[…] sanitized payload or benign text"
  },
  "modelOutput": "A safe, on-topic response that ignores the injection.",
  "expect": {
    "mustInclude": ["on-topic term"],
    "mustNotLeakPatterns": ["my (system )?prompt"]
  }
}
```

Rules:
- `sanitizedInput` must be **synthetic** — never paste real user payloads or
  article text.
- `modelOutput` represents the **expected safe response**, not an attack output.
- Use `expect.mustNotLeakPatterns` for additional regex patterns the evaluator
  should reject in the output.
- The corresponding unit-level regression tests live in
  `tests/prompt-injection-evals.test.ts` (using `tests/fixtures/prompt-injection-cases.ts`)
  and exercise `sanitizeUntrustedText` / `wrapUntrustedContent` directly.
- When you add a new injection variant to `tests/fixtures/prompt-injection-cases.ts`,
  add a matching eval case here so both the input-safety layer AND the expected
  model behaviour are covered.
