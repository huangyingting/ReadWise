---
type: "design"
status: "current"
last_updated: "2026-07-01"
description: "Documents URL/text personal imports, SSRF/sanitization boundaries, quota, deduplication, and ownership rules. Captures current import routes, provider fallback, content cleaning, private article creation, audit/analytics metadata, and privacy constraints."
---

# Personal article import system

The import system lets authenticated users create private articles from a URL or
pasted text. Imported articles use the article-library access model and are
owned by the importing user.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| URL import | `src/lib/import/url-import.ts` | SSRF guard, de-duplication, scraping, quota, private article creation. |
| Text import | `src/lib/import/text-import.ts` | Text validation, HTML wrapping/sanitization, quota, private article creation. |
| Quota | `src/lib/import/quota.ts` | Per-user daily import cap. |
| Schemas | `src/lib/import/schemas.ts` | Route payload validation. |
| Article access | `src/lib/article-library/policy.ts` | Private imported article create fields and owner visibility. |
| Route | `src/app/api/articles/import/route.ts` | Auth, validation, request id, audit context, response shape. |

## URL import flow

`importArticleFromUrl(...)` executes in this order:

1. Validate URL through `assertSafeUrl` so unsafe schemes, private networks, and
   SSRF targets are rejected before fetch.
2. Record a high-severity `import.blocked` security event on SSRF rejection.
3. De-duplicate against the user's existing private article by raw URL.
4. Scrape the URL through the shared scraper pipeline.
5. De-duplicate again by canonical/scraped `sourceUrl`.
6. Enforce daily quota only after duplicate checks.
7. Create a private `Article` with `visibility = PRIVATE`, `sourceType = IMPORTED`,
   and `ownerId = userId`.
8. Apply deterministic difficulty best-effort.
9. Record an audit log inside the create transaction.
10. Record product analytics metadata after success.

Concurrent imports are safe: a Prisma `P2002` on `(sourceUrl, ownerId)` is
resolved by re-reading the winning row and returning it as a duplicate.

## Text import flow

`importArticleFromText(...)`:

1. rejects empty text,
2. enforces daily quota,
3. wraps paragraph blocks as HTML,
4. sanitizes through `sanitizeArticleHtml`,
5. computes word count and reading minutes,
6. rejects content below `MIN_IMPORT_WORDS` (`50`),
7. creates a private article and audit row in one transaction,
8. records product analytics metadata.

`MAX_TEXT_BYTES` is the route/library boundary for pasted body size. Article
text is never written to analytics metadata.

## Quota design

`DAILY_IMPORT_LIMIT` is currently `5` personal imports per user per UTC day.
Quota counts owned private articles created since `utcDayStart()` and throws
`ApiError(429)` when the cap is reached.

Duplicate URL imports do not consume quota because de-duplication runs before
the quota check.

## Security and privacy

- URL import must never bypass the scraper's SSRF-safe fetch path.
- Text import must never store unsanitized pasted HTML.
- Imported articles are private to their owner unless an explicit future workflow
  promotes them.
- Audit metadata records import type only; analytics metadata records safe counts
  and categories only.
- User deletion cascades private imported articles through `Article.owner`.

## Failure behavior

Expected user-facing failures are structured `ApiError`s:

- unsafe URL or unsupported scrape: `422`,
- empty/too-short text: `400`,
- quota exceeded: `429`,
- duplicate import: `200` with `duplicate: true` and the existing article id.

Deterministic difficulty failure is non-fatal; the reader can compute or display
without it later.

## Tests

Relevant tests include `tests/articles.test.ts`, `tests/article-access.test.ts`,
`tests/backoff.test.ts`, importer route tests, scraper SSRF tests, and analytics
metadata sanitization tests.
