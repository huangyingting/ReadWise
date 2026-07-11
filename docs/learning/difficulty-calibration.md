---
type: "reference"
status: "current"
last_updated: "2026-07-11"
description: "Privacy-safe CEFR, OneStop-style ordinal, Lexile-like, provider drift, and vocabulary penalty calibration workflow."
---

# Difficulty calibration and aggregate evaluation

ReadWise article difficulty uses `deterministic-cefr/hybrid-calibrated-v5`.
CEFR output remains heuristic/hybrid-calibrated. v5 corrects typographic
apostrophe (U+2019) normalization so curly-apostrophe contractions receive the
same lexical band as their straight-apostrophe equivalents. Thresholds,
weights, and calibration data are unchanged from v4. v4 uses project-approved,
explicitly opted-in UniversalCEFR/elg_cefr_en NC evidence as full A1-C2 input
plus OneStopEnglish-style article data as three-level ordinal anchors.
`lexileApprox` is Lexile-like and is not an official Lexile measure.

## Harness

Run the aggregate-only harness:

```bash
npm run difficulty:eval -- --calibration ../calibration/local-cefr.jsonl --json
npm run difficulty:eval -- --onestop ../calibration/onestop-ordinal.tsv
npm run difficulty:eval -- --words-cefr ../calibration/mit-words.sqlite --json
npm run difficulty:eval -- --provider-dbs --snapshot-out test-results/provider-difficulty-snapshot.json
npm run difficulty:eval -- --provider-db workinprogress.db --provider-limit 25 --json
npm run difficulty:eval -- --calibration ../calibration/universalcefr.jsonl --enable-nc --json
npm run difficulty:eval -- --calibration ../calibration/elg-cefr-en.json --enable-nc --onestop ../calibration/onestop-ordinal.jsonl --json
```

Calibration and vocabulary inputs must be user-provided local files outside this
repository. Supported calibration formats are JSON, JSONL/NDJSON, CSV, and TSV.
SQLite is also supported for the MIT Words-CEFR vocabulary audit.

The harness reports only aggregate data:

- counts and score/`lexileApprox` percentiles;
- predicted CEFR and three-level ordinal distributions;
- confusion matrices, exact match, and within-one-level rates when labels exist;
- Lexile-like range/correlation/monotonicity summaries by label;
- vocabulary frequency-band agreement and penalty summaries;
- provider DB distribution drift and stale/missing stored difficulty counts.

It intentionally omits raw article text, titles, excerpts, article IDs, and word
examples from stdout and JSON reports.

## Non-commercial dataset gate

Non-commercial calibration/vocabulary corpora are disabled by default. Use
`--enable-nc` only after confirming the local evaluation use complies with the
dataset terms and legal approval is documented for the calibration run.
The harness rejects NC/CC-BY-NC/CC-BY-NC-SA sources without that flag when the
path or metadata identifies:

- UniversalCEFR/elg_cefr_en;
- Cambridge CEFR datasets;
- CEFR-SP;
- `CC BY-NC`, `CC BY-NC-SA`, or other non-commercial terms.

OneStopEnglish remains allowed without `--enable-nc` because this workflow treats
it as a CC BY-SA 4.0 ordinal-anchor source. Aggregate JSON and console reports
include `datasetSources` entries with `license`, `nonCommercial`, and gate
metadata so reviews can distinguish CC BY-SA sources from opt-in NC sources.

No-raw-text policy still applies when `--enable-nc` is used: do not commit source
corpora, provider text, titles, excerpts, article IDs, selected text, word
examples, or copied dataset passages. Keep source files outside the repository
and commit only aggregate reports that are free of raw content.

## Provider DB drift

`--provider-dbs` scans only `prisma/provider-dbs/*.db`. It does not evaluate
root `prisma/*.db` files and does not include sidecars such as `*.db-wal`,
`*.db-shm`, or `*.db-journal`.
Use `--provider-db <basename>` and `--provider-limit <count>` only for local
smoke checks; omit both flags for reproducible full-corpus drift snapshots.

To compare future drift safely:

```bash
npm run difficulty:eval -- --provider-dbs --snapshot-out test-results/provider-difficulty-snapshot.json
npm run difficulty:eval -- --provider-dbs --compare-snapshot test-results/provider-difficulty-snapshot.json --drift-threshold 0.10
```

Snapshots contain aggregate distributions only, so they are safe for regression
review when kept free of article IDs and raw content.

## Human-labeled provider samples

For manual calibration, copy
[`provider-difficulty-labels.template.csv`](./provider-difficulty-labels.template.csv)
to a local working file and fill only:

- provider DB path or basename;
- article ID from that provider DB;
- CEFR label and/or three-level ordinal label;
- optional aggregate reviewer guidance.

Do not copy article text, title, excerpt, selected text, or notes into the label
file. Run the labeled aggregate report with:

```bash
npm run difficulty:eval -- --provider-dbs --provider-labels ../calibration/provider-labels.csv --json
```

## Expected input columns

Calibration rows may use `text`, `content`, `article_text`, `body`, `html`,
`contentHtml`, or `passage` plus `cefr`, `level`, `label`, or `difficulty`.
OneStop-style ordinal rows may use `ordinal`, `ose_level`, `onestop`, `level`, or
`label` with elementary/intermediate/advanced values.
Optional metadata columns such as `dataset`, `source`, `license`, `licence`,
`rights`, or `terms` may be present; if they indicate NC/CC-BY-NC terms, the
harness requires `--enable-nc`.

MIT Words-CEFR exports should expose a word-like column (`word`, `lemma`,
`headword`, or `item`) and a CEFR-like column (`cefr`, `level`, `label`, or
`cefr_level`). SQLite exports are inspected for the first table with both column
families.
