---
type: "reference"
status: "current"
last_updated: "2026-07-22"
description: "Category-aware Simplified Chinese translation prompts for prisma/provider-dbs articles: the offline prompt lab, evaluation methodology, and current recommendation. Prompts only — no batch translation has been run against provider-dbs yet."
---

# Provider-DB translation prompt lab

This documents the **offline experiment** used to pick Simplified Chinese
(zh-CN) translation prompts for articles stored in `prisma/provider-dbs/*.db`,
targeting a locally hosted `Qwen/Qwen3.6-27B` served by vLLM
(`http://localhost:8000/v1`, OpenAI-compatible).

**Scope note:** this is a prompt-selection exercise only. The lab scripts
never write to `prisma/provider-dbs/*.db` or any application database — they
read a sample of articles, translate the sample, and score the result. A
batch job that actually persists provider-db translations is a separate,
not-yet-built follow-up.

## Why category-aware prompts

`Article.category` across the 20 provider databases has 14 distinct values
(`animals`, `business`, `culture`, `entertainment`, `environment`, `health`,
`history`, `ideas`, `politics`, `science`, `sports`, `tech`, `travel`,
`world`). A single generic translation prompt under-serves at least two of
these registers:

- **News** (`business`, `politics`, `world`) needs a neutral, formal register
  and consistent transliteration/acronym handling.
- **Technical** (`tech`, `science`, `health`, `environment`) needs precision
  over elegance — units, named substances/species, and quantitative claims
  must not drift.
- **Narrative** (`culture`, `entertainment`, `history`, `travel`, `ideas`,
  `animals`) is feature/essay prose where idiomatic fluency matters more than
  literal word order.
- **Sports** (`sports`) has its own terminology and energetic tone.

`scripts/translation-prompt-lab/categories.ts` maps all 14 categories onto
these four **profiles**, and `prompts.ts` holds one or more candidate prompts
per profile.

## Lab pipeline

```
scripts/translation-prompt-lab/
  categories.ts    category → profile mapping
  prompts.ts       candidate prompts per profile + recommendedPrompt()
  vllm-client.ts    minimal OpenAI-compatible client for the local vLLM server
  sample.ts         samples article excerpts from provider-dbs
  translate.ts      runs prompt variants against the sample via vLLM
  evaluate.ts       heuristics + LLM-judge scoring, aggregated per variant
```

```bash
npm run translation-lab:sample -- --per-category 1 --max-chars 1800 --db new-yorker
npm run translation-lab:translate -- --variants all
npm run translation-lab:evaluate
```

All three write their working data (article text, translations, per-sample
judge output) to `.translation-lab/` at the repo root, which is **gitignored
and must never be committed** — it contains copyrighted provider article
text. Console output from every script is aggregate-only (counts, timings,
scores); no article text, title, or translation is ever printed. This mirrors
the existing convention in `scripts/difficulty-eval.ts`.

### vLLM thinking mode

`Qwen/Qwen3.6-27B` on this server defaults to "thinking" mode: with thinking
on, the entire `max_tokens` budget was consumed by `message.reasoning` and
`message.content` came back `null` (`finish_reason: "length"`), observed
directly against this deployment. `vllm-client.ts` sends
`chat_template_kwargs: { enable_thinking: false }` on every request — both
translation and judging are deterministic transformation tasks that don't
need visible chain-of-thought, and leaving thinking on made the transport
unusable.

## Evaluation methodology

For each sampled article excerpt, every candidate prompt for that article's
profile is run once, then scored two ways:

1. **Heuristics** (deterministic): non-empty, no markdown fences, output
   paragraph count matches source paragraph count, output is at least 70%
   CJK characters (a sanity floor, not a fluency gate — legitimate news/tech
   output keeps organization names, drug names, etc. in Latin script), and
   output/source character-length ratio is in a plausible band.
2. **LLM judge** (same vLLM server, `temperature: 0`, thinking disabled):
   scores `adequacy`, `fluency`, `terminology`, and `register` from 1–5 and
   lists up to 3 concrete issues, given the source excerpt, its category, and
   the candidate translation.

`evaluate.ts` aggregates both by prompt-variant id and prints a summary table;
full per-sample detail (including the judge's issue notes, which sometimes
quote short translation fragments) is written to the gitignored scratch
directory for manual spot-checking, never committed.

## What the lab found

Baseline run: 1 provider db (`new-yorker`, which alone covers all 14
categories), 1 article per category (14 articles), baseline vs. specialized
prompt per profile, `Qwen/Qwen3.6-27B` via local vLLM.

- **News, technical, sports**: baseline and specialized prompts scored
  statistically indistinguishable (both frequently 5.00/5.00 on the judge's
  1–5 scale, at n=1–4 samples per profile). The specialized prompts were kept
  as the recommendation anyway — they encode terminology/register rules
  (acronym handling, unit/claim precision, established name conventions)
  that matter for correctness at translation scale even where a
  single-digit-sample judge run can't show a measurable gap.
- **Narrative**: this is where prompt specialization mattered. The judge
  flagged a *reproducible* failure mode on New Yorker-style prose that
  code-switches into other languages (Yiddish/French slang, e.g. "haimish",
  "mish-pokah"): both the generic baseline and the first specialized prompt
  left these embedded foreign words untranslated inside the Chinese output,
  breaking fluency. A second pass also caught a factual slip — "twenty
  thousand words" mistranslated as "两万句话" ("twenty thousand *sentences*") —
  that the specialized prompt's explicit license to rephrase for fluency
  seems to have enabled. `narrative/v3-specialized` adds an explicit rule:
  translate every embedded word/slang/interjection into Chinese (proper nouns
  with no accepted Chinese form are the only exception), and rephrasing for
  fluency must never change exact counts/quantities/names.
  - An isolated re-run on just the 6 narrative-profile samples confirmed the
    fix (overall judge score 4.79 for v3 vs. 4.33 for baseline, with the
    code-switching issue disappearing from 5 of 6 categories).
  - A subsequent full 28-run pass, after also fixing a sampling bug (see
    below), showed the two variants trading places on aggregate score
    (4.92 baseline vs. 4.75 v3) because `translate.ts` runs at
    `temperature: 0.3` — different runs produce different translations, and
    single-category samples (n=1) are within the judge's noise band either
    way. The **specific failure mode v3 targets is real and reproduced twice
    independently**; the aggregate ranking at n=1/category is not yet
    reliable enough to be the last word.

**Sampling bug found and fixed along the way:** `sample.ts`'s paragraph-aware
truncation fell back to a raw character cut (mid-sentence, sometimes
mid-word) when an article's first paragraph alone exceeded `--max-chars`. It
now falls back to the last sentence boundary instead. This affected the
*source* excerpt fed to both variants equally, but produced misleading judge
complaints about "the source is cut off mid-word" that had nothing to do with
either prompt.

## Current recommendation

`scripts/translation-prompt-lab/prompts.ts` exports
`recommendedPrompt(profile)` / `recommendedPromptForCategory(category)`,
currently pointing at the specialized prompt for every profile
(`news/v2-specialized`, `technical/v2-specialized`,
`narrative/v3-specialized`, `sports/v2-specialized`). A future batch
translation script should import from there rather than re-deriving prompts.

**Before trusting this for a real batch run:** re-run
`translation-lab:sample` with a larger `--per-category` (10+) across more
provider dbs, and treat variant deltas smaller than roughly one point on the
1–5 judge scale as noise at the current sample sizes and `temperature: 0.3`
translation setting. The category→profile grouping and the narrative
code-switching fix are the two conclusions with the strongest evidence; the
news/technical/sports "specialized ≥ baseline" conclusion is a reasonable
default, not yet a statistically established result.

## Related documents

- [`ai/prompts.md`](./prompts.md) — the production prompt registry
  (`src/lib/ai/prompts/`) that this lab deliberately does not touch; provider-db
  batch translation is an offline concern with its own local model, not a
  registered production feature (yet).
- [`ai/evaluations.md`](./evaluations.md) — the production offline/live AI
  evaluation harness (`scripts/eval.ts`, `evals/*.json`), which this lab
  mirrors in spirit (heuristics + judged samples) but runs independently
  since it targets a different transport (local vLLM, not the configured
  production provider).
