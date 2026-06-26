# Content Extraction Quality Checks

Reference for the automated quality signals that guard extracted article content
before it is persisted as a draft, plus the triage workflow for scraper drift.

## Overview

`src/lib/scraper/quality.ts` provides `checkContentQuality(article)`, which scores
a `ScrapedArticle` against a battery of named signals after extraction (but
before persistence in `saveDraftArticle`).  The result is logged — never
stored or exposed to users — and the pipeline acts on the composite grade.

| Grade | Meaning | Pipeline action |
|-------|---------|-----------------|
| `ok` | All critical and major checks pass | Proceed to `saveDraftArticle` |
| `warn` | ≥ 1 major signal fired | Log at WARN level; persist (operator review) |
| `reject` | Critical check failed (empty body, < 50 words) | Skip persistence; return `failed` outcome |

---

## Quality signals

### Critical (grade → `reject`)

| Check | Condition |
|-------|-----------|
| `empty-body` | Stripped plain-text length is zero |
| `word-count` | Extracted word count < `MIN_WORD_COUNT` (50) |

These are hard gates.  `extractArticle` already rejects articles with < 50 words,
so the quality module catches edge cases like a provider returning a blank response.

### Major (grade → `warn`)

| Check | Condition | Threshold |
|-------|-----------|-----------|
| `paywall-marker` | Body matches a subscription/gate phrase | Any match |
| `encoding-garbage` | Ratio of garbage codepoints to total chars > threshold | `MAX_GARBAGE_RATIO` = 2 % |
| `link-density` | Ratio of link-text to plain-text > threshold | `MAX_LINK_DENSITY` = 50 % |
| `boilerplate-heavy` | ≥ N boilerplate patterns match (copyright, privacy policy, ToS…) | `BOILERPLATE_HIT_THRESHOLD` = 3 |

### Advisory (reduce score; do **not** change grade)

| Check | Condition | Score deduction |
|-------|-----------|-----------------|
| `missing-author` | `author` is `null` | −5 |
| `missing-date` | `publishedAt` is `null` | −5 |

Advisory signals lower the composite score (0–100) but do not change a grade of
`ok` to `warn`.  They are useful for tracking metadata completeness trends.

---

## Composite score

`score = 100 − Σ(deductions)`, clamped to `[0, 100]`.

| Signal | Deduction |
|--------|-----------|
| `empty-body` | 100 |
| `word-count` (< 50) | 50 |
| `word-count` (< 150, ≥ 50) | 10 |
| `paywall-marker` | 30 |
| `encoding-garbage` | 25 |
| `link-density` | 20 |
| `boilerplate-heavy` | 20 |
| `missing-author` | 5 |
| `missing-date` | 5 |

---

## Privacy constraints

`checkContentQuality` **never** logs or persists article text, titles, selected
text, or any content.  Only the following non-PII metrics are emitted:

```
{ grade, score, wordCount, failedChecks: string[], sourceUrl }
```

Logs are emitted at `DEBUG` for `ok` articles and `WARN` for degraded ones,
using the `scraper.quality` logger.

---

## Drift triage workflow

Use this checklist when a provider starts producing low-quality articles.

### 1. Identify the failing signal

Search logs for `content quality degraded` with the provider's hostname:

```sh
# grep application logs (adjust for your log backend)
grep '"event":"content quality degraded"' app.log | grep 'provider.example.com'
```

Inspect `failedChecks` in the log entry.

### 2. Map signal to root cause

| Signal | Likely cause |
|--------|-------------|
| `paywall-marker` | Provider added a subscription gate; scraper captured the gate page |
| `encoding-garbage` | Provider changed charset, or gzip/Brotli response not decoded correctly |
| `link-density` | Scraper matched a category/index page instead of an article page |
| `boilerplate-heavy` | Provider reorganised layout; footer/legal text leaking into extraction |
| `word-count` | Provider added JavaScript-rendered lazy-load; raw HTML too sparse |
| `empty-body` | Provider changed HTML structure; `<article>` selector no longer matches |

### 3. Reproduce with a fixture

Copy the raw HTML from the failing URL into an inline fixture in
`tests/scraper-quality-checks.test.ts` (or a provider-specific test) and
assert the expected grade.  Keep the fixture synthetic — replace real article
text with placeholder words.

### 4. Fix the provider or cleanup rules

- **Selector drift** (empty body, low word count): update the provider's
  `cleanup.dropSelectors` / `cleanup.dropClassKeywords` in
  `src/lib/scraper/providers/`.
- **Paywall capture**: add the subscription URL pattern to the provider's
  `articleUrlFilter` to reject gated URLs during discovery.
- **Encoding issues**: check `Content-Type` / `charset` response headers and
  confirm `fetchHtml` decodes them correctly (`src/lib/scraper/fetch.ts`).
- **Index page match**: tighten the provider's `articleUrlPattern` to exclude
  section/category pages.

### 5. Confirm with tests

After the fix:

```sh
npm test -- --test-name-pattern "quality|scraper"
```

Confirm the fixture that was failing is now `ok` and no regression tests break.

### 6. Disable a drifted provider (operator action)

If a provider cannot be fixed quickly, disable it via the admin content-source
API until the fix lands:

```sh
# via CLI script
tsx scripts/scrape.ts --disable-provider <key>
```

See `docs/content/content-policy.md` for the governance workflow.

---

## Adding new quality checks

1. Add the check in `src/lib/scraper/quality.ts` following the existing pattern
   (signal name, threshold constant, deduction value).
2. Export the threshold constant so tests can reference it.
3. Add a passing and a failing test in `tests/scraper-quality-checks.test.ts`.
4. Update the tables in this document.

---

## Files

| File | Purpose |
|------|---------|
| `src/lib/scraper/quality.ts` | Quality checker implementation |
| `tests/scraper-quality-checks.test.ts` | Drift-triage fixture tests |
| `src/lib/scraper/index.ts` | Wiring: `scrapeAndSave` calls `checkContentQuality` |
| `docs/content/scrapers.md` | Provider guide and extraction pipeline reference |
