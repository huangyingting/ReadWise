---
title: "Article quality cleanup and duplicate analysis design"
category: "Content"
architecture: "Documents content-quality cleanup analysis and duplicate-detection design around scraped public-library articles."
design: "Captures proposed/current cleanup signals, review workflow, safety limits, and operator-facing analysis approach."
plan: "Update when scraper quality classifiers, cleanup scripts, duplicate rules, or admin review workflows change."
updated: "2026-07-01"
rename: "none"
---

# Article quality cleanup and duplicate analysis design

Status: proposed design, not yet implemented.

This document records the agreed design for cleaning an existing backlog of
scraped public-library articles and preventing future garbage articles from
entering the library. It complements the current scraper quality reference in
[`extraction-quality.md`](./extraction-quality.md).

## Problem

Large scraping runs can persist pages that are not useful reading material:

- promotion, sales, coupon, newsletter, subscription, or advertisement pages,
- broken extractions dominated by navigation, boilerplate, source code, or login
  gates,
- exact duplicate articles saved through different URLs or markup,
- near-duplicate/syndicated articles that should be reviewed before curation.

The cleanup must improve library quality without accidentally removing useful
articles, disrupting readers, or exposing article text in logs and analytics.

## Current baseline

The existing codebase already has these relevant pieces:

- `src/lib/scraper/quality.ts` exposes `checkContentQuality(article)` with named
  signals and a composite `ok` / `warn` / `reject` grade.
- `src/lib/scraper/quality-classifier.ts` provides a local Naive-Bayes
  `article` / `ad` classifier, gated by scraper runtime configuration.
- `Article` has editorial fields: `status`, `reviewState`, and `qualityFlags`.
- `ContentReview` records append-only review changes.
- Public feeds require `visibility = PUBLIC`, `status = PUBLISHED`, and
  `ownerId = null`.
- The article processor can auto-publish `DRAFT` rows after enrichment, so
  quarantined articles must not remain ordinary processable drafts.

## Goals

1. Analyze the existing scraped public-library backlog.
2. Reject or quarantine high-confidence garbage with minimal false positives.
3. Detect exact content duplicates and flag likely near-duplicates.
4. Persist non-text quality metadata for safe re-runs and admin review.
5. Keep future scraper ingestion from reintroducing known garbage.
6. Preserve reader/classroom history and avoid surprising public-content changes.

## Non-goals

- No hard deletion in v1.
- No bulk LLM classification.
- No rights/copyright automation; rights decisions remain in the takedown
  workflow documented in [`content-policy.md`](./content-policy.md).
- No bulk admin action on private user imports in v1.
- No article body, excerpt, selected text, or prompts in logs, reports, metrics,
  or analysis metadata.

## Scope

v1 scope is public scraped library articles only:

```text
sourceType = SCRAPED
ownerId = null
```

Private imports may still receive import-time quality feedback, but the bulk
cleanup job must not archive private user content unless a future design
explicitly scopes that workflow.

## Storage design

Add a dedicated latest-snapshot analysis table instead of overloading
`Article.qualityFlags` with operational data.

Proposed model shape:

| Field | Purpose |
| --- | --- |
| `articleId` | One analysis snapshot per article. |
| `algorithmVersion` | Version string for deterministic reruns and threshold changes. |
| `qualityGrade` | Current `ok` / `warn` / `reject` result. |
| `qualityScore` | Composite score from quality checks. |
| `failedChecks` | JSON array of failed quality signal names only. |
| `normalizedUrlHash` | Hash of canonicalized URL identity when present. |
| `normalizedContentHash` | Hash of normalized plain text for exact content duplicates. |
| `nearDuplicateFingerprint` | Compact fingerprint used for near-duplicate blocking. |
| `duplicateGroupKey` | Stable group id for exact duplicate sets. |
| `duplicateOfArticleId` | Survivor article id when this row is a duplicate. |
| `proposedAction` | `keep`, `needs_work`, or `archive`. |
| `appliedAction` | Last action actually applied, if any. |
| `analyzedAt` | Last analysis timestamp. |
| `appliedAt` | Last apply timestamp, if any. |

Keep SQLite and PostgreSQL Prisma schemas in parity when this model is
implemented.

`Article` remains the user/admin-facing summary:

- high-confidence junk: `status = ARCHIVED`, `reviewState = rejected`,
  relevant `qualityFlags`,
- uncertain cases: `reviewState = needs_work`, relevant `qualityFlags`,
- clean cases: no analyzer-driven status change.

`ContentReview` should record applied changes so moderation history stays
auditable.

## Analysis pipeline

The analyzer should be local, deterministic, and resumable.

1. Select scoped article rows in batches.
2. Convert stored sanitized HTML to normalized plain text.
3. Run existing `checkContentQuality(...)`.
4. Run local ad/article classifier only as a supporting signal.
5. Compute normalized URL and normalized content hashes.
6. Build near-duplicate fingerprints for review-only duplicate candidates.
7. Choose a proposed action.
8. Upsert the latest `ArticleQualityAnalysis` snapshot.
9. In `--apply` mode, apply only allowed actions and append `ContentReview`.

The first implementation should be a CLI, not an admin UI or background worker.
Proposed command shape:

```sh
npm run analyze:articles -- --dry-run --report .scraper-state/article-quality.jsonl
npm run analyze:articles -- --apply
npm run analyze:articles -- --apply --include-published
```

These commands are proposed; add the package script only when the analyzer is
implemented.

## Action matrix

Use high precision. The analyzer should prefer review flags over automatic
archive when there is uncertainty.

| Condition | Proposed action | Article summary |
| --- | --- | --- |
| Critical extraction failure: `empty-body`, `code-content`, `non-english`, or `digest-listicle` | `archive` | `ARCHIVED`, `rejected`, quality flag |
| Exact normalized-content duplicate | `archive` duplicate rows | `ARCHIVED`, `rejected`, `duplicate_exact`; link to survivor |
| Warning combination: `ad-copy`, `paywall-marker`, `boilerplate-heavy`, `link-density`, `weak-sentence-structure`, or `repetitive` | `needs_work` | keep status unless draft-publish blocking applies; add relevant flags |
| Near duplicate above high threshold | `needs_work` | add `duplicate_near`; do not auto-archive |
| Metadata-only issues, such as missing author/date | `keep` | no status change |
| Clean article | `keep` | no status change |

Suggested admin-facing flags:

- `extraction_broken`
- `promotional_or_ad`
- `paywall_or_login`
- `boilerplate_heavy`
- `duplicate_exact`
- `duplicate_near`
- `thin_content`

## Duplicate detection

### Exact duplicates

Auto-quarantine only exact duplicates based on normalized plain text, not raw
HTML bytes.

Normalization should:

- strip HTML,
- collapse whitespace,
- lowercase,
- normalize common quote and punctuation variants,
- remove markup-only differences,
- hash the resulting text.

This catches identical articles with different markup while avoiding accidental
near-duplicate removal.

### Survivor selection

For an exact duplicate group, keep one survivor using deterministic ordering:

1. already `PUBLISHED` or `approved` article,
2. better metadata completeness (`sourceUrl`, `author`, `publishedAt`,
   `heroImage`, `category`),
3. higher word count,
4. earliest `createdAt`.

Archive the other rows and set `duplicateOfArticleId` to the survivor.

### Near duplicates

Near-duplicate detection is review-only in v1.

Use cheap blocking before similarity comparison so the analyzer avoids all-pairs
comparison across the corpus. A high threshold, around `>= 0.90` to `>= 0.92`
text-shingle similarity, should produce `duplicate_near` review flags without
flooding moderation with merely related articles.

Near-duplicate comparison may cross sources, but cross-source matches must not
be auto-archived in v1.

## Apply safety

The first cleanup run should be staged:

1. Dry-run all scoped rows.
2. Review a calibration sample of roughly 100 to 200 rows, weighted toward
   proposed `archive` and `needs_work`.
3. Apply to drafts first.
4. Apply to published rows only with an explicit `--include-published` flag.

When a published article has user engagement, downgrade automatic `archive` to
`needs_work` unless a future force flag is explicitly designed. Engagement
signals include reading progress, highlights, reading-list membership,
assignments, quiz attempts, or similar reader/classroom state.

## Future ingestion behavior

Future public scraper ingestion should run the same analysis before persistence
where possible.

- Clear high-confidence garbage: reject before saving an `Article` row and
  record only non-text metrics in crawl counters/reports.
- Uncertain content: save as `DRAFT` with `reviewState = needs_work` and flags.
- Clean content: save normally.

The processing/publish path must not auto-publish `needs_work` or `rejected`
drafts. Admin approval should be required before those rows can become public.

## Reporting and privacy

Dry-run output should be privacy-safe:

- aggregate counts by source, status, proposed action, and failed check,
- JSONL/CSV report with article id, source, status, score, failed check names,
  duplicate survivor id, and proposed action,
- no article body, excerpt, selected text, prompts, or private user content.

Full content inspection should happen through the existing admin review surface,
not in CLI logs or exported reports.

## Performance target

The analyzer should run as a local single-process CLI in batches of 500 to 1000
articles. It should not call the network or AI providers. For a corpus on the
order of tens of thousands of rows, the target is minutes-scale runtime.

Near-duplicate matching must use blocking/fingerprints rather than naive
all-pairs comparison.

## Implementation checklist

1. Add `ArticleQualityAnalysis` to both Prisma schemas and migrations.
2. Add deterministic text normalization, hash, and fingerprint helpers with
   synthetic tests.
3. Add a reusable article-quality analysis module that wraps current quality
   checks and local classifier signals.
4. Add the resumable CLI with `--dry-run`, `--apply`, `--include-published`,
   `--limit`, `--source`, `--status`, and report-output options.
5. Add apply logic that updates `Article`, writes `ContentReview`, and protects
   engaged articles.
6. Add ingestion gate wiring so future scraper runs reject clear garbage and
   block uncertain drafts from auto-publish.
7. Extend existing admin review flags with analyzer-oriented flags.
8. Add tests for action selection, duplicate survivor selection, engagement
   protection, and publish blocking.
9. Update operator docs and package scripts after implementation.

