---
title: "Article library design"
category: "Content"
architecture: "Documents Article Library visibility, status, ownership, moderation, and access-policy boundaries."
design: "Captures current article lifecycle, public/private listing behavior, admin operations, and safety/privacy constraints."
plan: "Update when Article schema, access policy, listing routes, moderation, or admin article workflows change."
updated: "2026-07-01"
rename: "none"
---

# Article library design

The article library is the core domain boundary for public curated articles,
private imports, article access policy, listing read models, admin article
operations, moderation, and article-owned derived content.

It ties together content ingestion (`docs/content/scrapers.md`), reader features
(`docs/reader/`), operations (`docs/operations/admin-operations.md`), and the
visibility ADR
([`../architecture/0002-article-visibility-and-access-service.md`](../architecture/0002-article-visibility-and-access-service.md)).

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Access policy | `src/lib/article-library/policy.ts` | Centralized visibility/read/edit/admin/AI-process predicates and Prisma `where` builders. |
| Public/personal listings | `src/lib/article-library/listings.ts` | Public feeds, category pages, picks fallback ranking, personal imports. |
| Mapping | `src/lib/article-library/mapper.ts` | Safe listing-card shape and reading-minute normalization. |
| Admin operations | `src/lib/article-library/admin.ts` | Admin listing/detail, delete, rebuild derived AI content. |
| Moderation/rights | `src/lib/article-library/moderation.ts` | Review states, quality flags, takedown workflow, review history. |
| Collections | `src/lib/article-library/collections/` | Reading lists, bookmarks, list membership and schemas. |
| Content pipeline | `src/lib/content-pipeline/index.ts` | Sanitized HTML and canonical reader text extraction. |

## Article lifecycle axes

`Article` uses several independent axes. Do not collapse them into a single
status flag:

| Axis | Field(s) | Meaning |
| --- | --- | --- |
| Visibility | `visibility`, `ownerId`, `organizationId` | Public library article, user-private import, or future tenant-scoped content. |
| Processing lifecycle | `status` | `DRAFT`, `PROCESSING`, `PUBLISHED`, `FAILED`, `ARCHIVED`. |
| Source | `sourceType`, `sourceUrl`, `canonicalUrl` | Scraped vs imported content and upstream identity. |
| Rights/governance | `takedownState`, `rightsNote` | Whether content can be publicly shown. Rights state wins over editorial status. |
| Editorial review | `reviewState`, `qualityFlags`, `ContentReview` | Human moderation state and append-only change history. |
| Derived content | translations, vocabulary, quiz, tags, speech, processing steps | Cacheable/lazy AI or media artifacts tied to the article. |

## Access policy

Every article read/write must go through `src/lib/article-library/policy.ts` or
a helper that calls it.

| Predicate | Who can access |
| --- | --- |
| Public-listable | `visibility = PUBLIC`, `status = PUBLISHED`, `ownerId = null`. Anonymous readers may see these. |
| Readable | Operators can read any article; authenticated users can read public-listable articles plus their own private imports. |
| Editable | Operators can edit any article; readers can edit only their own private imports. |
| Admin-visible | Operators only. |
| AI-processable | Same as readable; AI helpers must not process articles the actor cannot read. |

The access context already has optional tenant/org fields. When tenant-scoped
article feeds become active, add the tenant predicate here so all callers inherit
the rule.

## Listings and caching

Public listings use `publicListableArticleWhere()` and shared listing caches.
Personal imports use `ownedArticleWhere(userId)` and are not public-cacheable.

Key listing surfaces:

- latest public articles (`listPublishedArticles`),
- category pages (`listCategoryPage`),
- level/topic picks fallback (`listPicksPage`),
- personal imports (`listPersonalArticlesPage`).

Public feeds must never include private or organization-scoped rows through a
shared cache key. New user/org-specific feeds must include the user/org dimension
in the cache key, as described in
[`../access/multi-tenancy.md`](../access/multi-tenancy.md).

## Curated reading series access (#813)

`ReadingSeries.articleIds` is an ordered `Json` array of article ids that are
**NOT** foreign keys — a series survives article deletion. Series content is
held to the same visibility/access rules as every other listing: an article id
only surfaces (in the Today series candidate or anywhere else) after it is
revalidated at serve time through `getPublicListableArticleById` /
`publicListableArticleWhere`, identical to how Today backup ids are revalidated.

`src/lib/engagement/series.ts` owns this resolution. When the article at the
enrollment's `nextIndex` is private, unpublished, deleted, or otherwise
inaccessible it is silently skipped and `nextIndex` is advanced forward past it;
a private or inaccessible article therefore **never** appears as a Today series
candidate and series enrollment can **never** bypass Article Library visibility.
The Today generator injects the resolved series article as an additional
candidate scored by the same Picks scoring — never as a hard override.

## Moderation and rights workflow

`reviewArticle(...)` applies editorial corrections, review verdicts, quality
flags, and tags, then appends a `ContentReview` diff row.

`applyTakedown(...)` changes the rights state. Any non-`active` takedown state
forces a currently published article to `DRAFT`, so it leaves public feeds
immediately. Restoring `active` does not publish automatically; an editor must
explicitly publish after review.

Publishing is refused while `takedownState !== "active"`. This makes rights
policy stronger than editorial intent.

Operational details live in [`content-policy.md`](./content-policy.md) and
[`../operations/admin-operations.md`](../operations/admin-operations.md).

## Admin article operations

Admin article reads use `adminVisibleArticleWhere(...)`; a missing/unauthorized
article looks like a normal miss.

Destructive and derived-content operations:

- `deleteArticle` deletes the article and lets article-owned derived rows cascade.
- `rebuildArticleAi` clears translations, vocabulary, quiz questions, tags,
  speech cache, speech media pointers, and non-difficulty processing steps so
  they regenerate lazily or through jobs.
- Reader progress is preserved by rebuilds.
- Admin mutations must be audited with sanitized metadata.

## Content safety boundary

Stored/rendered article HTML must pass through `sanitizeArticleHtml` from
`src/lib/content-pipeline/index.ts`. Features that need plain text must use
`articleHtmlToReaderText(...)` so TTS, translation, highlights, vocabulary,
difficulty, and metadata all share the same text basis.

Never render stored or scraped article HTML directly.

## Access policy consumers

All Prisma-based consumers (Reader, Search Prisma path, Import, Scraper,
Processing) call `readableArticleWhere` / `getReadableArticleById` and related
helpers from this module. The one known raw-SQL consumer is
`buildReadableArticleSqlPredicate` in `src/lib/search/fulltext.ts`, which
manually mirrors `readableArticleWhere` for the PostgreSQL FTS `$queryRaw` path.
See `docs/reader/search-and-indexing.md` for the migration follow-up note and
`tests/search-sql-predicate.test.ts` for regression coverage.

## Tests

Important coverage includes `tests/article-access.test.ts`,
`tests/article-visibility-regressions.test.ts`, `tests/admin-article-read-models.test.ts`,
`tests/admin-articles*.test.ts`, `tests/articles.test.ts`,
`tests/articles-search.test.ts`, `tests/search-sql-predicate.test.ts`, and
content policy/moderation route tests.
