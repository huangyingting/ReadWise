---
type: "policy"
status: "current"
last_updated: "2026-07-01"
description: "Documents source governance, rights metadata, review, takedown, and provider-health boundaries. Captures current policy workflow, source controls, moderation actions, and privacy-safe metadata handling."
---

# Content policy: sources, rights & takedown

This document covers how ReadWise sources third-party reading content, the
governance controls around it, and the rights / takedown workflow. It is the
operational reference for editors, moderators and operators (Epic RW-E009 —
RW-046 / RW-047).

## Source usage

ReadWise ingests public news/feature articles to use as English-learning reading
material. Extraction is provider-aware and lives in code under
`src/lib/scraper/`:

- `providers/` — the registry of supported providers (NBC, National Geographic,
  Time, HuffPost, BBC News, Smithsonian Magazine, Knowable Magazine, Nautilus,
  MIT Technology Review, Noema Magazine, Undark, BBC Learning
  English), keyed by hostname, with article-URL patterns,
  provider-specific discovery hooks and category mapping.
- `extract.ts` — provider-agnostic extraction (schema.org JSON-LD first, then
  OpenGraph/`<p>` fallback) with SSRF protection and size/time caps. Bodies are
  sanitized via `sanitizeArticleHtml` before storage.
- `index.ts` — `scrapeUrl`, `discoverProviderUrls`, `saveDraftArticle`.

Scraped articles are stored as `draft` and de-duplicated by `sourceUrl`. They are
only published after the processing pipeline (and, where configured, human
review) has run.

### Provider governance (`ContentSource`)

Operational state for each provider lives in the `ContentSource` model (NOT the
extraction logic, which stays in code):

- `providerKey` (matches the code registry key), `displayName`, `baseUrl`
- `enabled` — when false, the scraper SKIPS the provider during discovery
- `crawlPolicy` — optional JSON policy (reserved for future per-provider rules)
- health/operational counters: `lastDiscoveryCount`, lifetime discovered/scraped/failed/duplicates/rejected totals, consecutive failure and zero-discovery streaks, `lastError`, and `lastCrawledAt`

Sync rows from the code registry with `syncContentSources()` (also exposed as
**Sync from registry** on `/admin/sources`, gated on the `sources.manage`
capability). Toggling a source is audited (`admin.source.toggle`).

The scraper consults `isProviderEnabled(providerKey)` before crawling. An
UNSYNCED provider (no row yet) defaults to enabled so discovery keeps working
before the first sync; once a row exists, its `enabled` flag is authoritative.

### Provider health

`recordCrawlRun(providerKey, outcome)` folds scraper/seeder run results into the
persisted counters and recomputes `healthStatus`:

| Status | Rule |
| --- | --- |
| `unknown` | Pre-first-crawl default. |
| `healthy` | No recent error/failure/zero-discovery streak. |
| `degraded` | At least one recent failed run, zero-discovery run, or lingering `lastError`. |
| `failing` | `consecutiveFailures >= 3` or `consecutiveZeroDiscovery >= 3`. |

A run counts as a failure when it records an explicit error, or when it
discovered URLs but saved zero articles. A zero-discovery run increments only the
zero-discovery streak. Every recorded crawl also emits ingestion metrics. See
[`admin-operations.md`](../operations/admin-operations.md) for the operator view.

### robots.txt & crawl restrictions

Before fetching a page, discovery calls `isUrlAllowed()` (`src/lib/scraper/robots.ts`),
which fetches + caches the origin's `robots.txt` and evaluates it for our product
token (`ReadWiseBot`). The parser supports grouped `User-agent` records,
`Allow`/`Disallow` with `*` wildcards and `$` anchors, and longest-match
precedence (Allow wins ties).

The check is deliberately **fail-open**: a missing/unreachable/unparseable
`robots.txt` is treated as "allowed" (the robots standard only constrains
crawling when an explicit `Disallow` matches). This keeps governance graceful — a
flaky robots endpoint never halts ingestion — while still honoring publishers
that explicitly opt out. Per-provider `crawlPolicy` from `ContentSource` can layer
additional restrictions on top in the future.

## Rights & takedown workflow

Each `Article` carries rights metadata:

- `canonicalUrl` — the publisher's canonical link
- `rightsNote` — a free-text licensing/usage note
- `takedownState` — one of:
  - `active` — normal; eligible to be published
  - `unpublished` — temporarily removed from public feeds
  - `archived` — retained internally, not shown publicly
  - `takedown` — removed in response to a rights/DMCA request

### Applying a takedown

Use the **Rights & takedown** panel on `/admin/articles/[id]` (gated on
`content.moderate`) or `POST /api/admin/articles/[id]/takedown`
(`{ state, note?, rightsNote? }`). The action (`src/lib/article-library/moderation.ts`
`applyTakedown`):

1. Any **non-active** state forces the article to `DRAFT` so it leaves public
   feeds immediately.
2. Restoring to `active` does **NOT** auto-publish — an editor must deliberately
   re-publish (via the review panel). This prevents accidental re-exposure of
   previously removed content.
3. Records a `ContentReview` history row (`takedown.<state>`) with a diff and the
   optional note, and is audited (`admin.article.takedown`).

Publishing is also guarded server-side: the review workflow refuses to publish an
article whose `takedownState` is not `active` (HTTP 409). Rights always win over
editorial intent.

### Responding to a takedown request

1. Locate the article in `/admin/articles` (search by title/source/URL).
2. Open the detail page and set the rights state to `takedown` (or `unpublished`
   while investigating), adding a `rightsNote` describing the request.
3. The article is unpublished immediately and the action is recorded in both the
   review history and the audit log.
4. If the request is later withdrawn, restore to `active` and re-publish via the
   review panel if appropriate.
