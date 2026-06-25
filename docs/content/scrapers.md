# Scraper Provider Guide

A reference for adding, configuring, and debugging ReadWise scraper providers.

## Overview

ReadWise ingests articles from curated news and magazine sources via a two-phase pipeline:

1. **Discovery** – collect candidate article URLs from a provider.
2. **Extraction** – fetch each URL through `scrapeUrl` → `extractArticle`, which
   sanitises the HTML and persists a draft `Article`.

Discovery is governed by robots.txt, content-source enablement, and provider-level URL
filters. Extraction always flows through `fetchHtml` (SSRF-protected) → `sanitizeArticleHtml`
(XSS-safe). **Never bypass these layers.**

---

## Provider type (`src/lib/scraper/types.ts`)

```ts
type Provider = {
  key: string;               // short CLI key, e.g. "bbc"
  name: string;              // human label stored as Article.source
  hostnames: string[];       // hostnames that belong to this provider
  seeds: string[];           // crawl roots (section / landing pages)
  articleUrlPattern: RegExp; // must match article URLs (not section pages)
  articleUrlFilter?: (url: string) => boolean; // optional secondary filter
  defaultCategory: string;   // fallback ReadWise category slug
  categoryFor?: (url: URL, section: string | null) => string | null;
  urlExtractor?: (ctx: UrlExtractorContext) => Promise<string[]>; // #360/#380
  paginateSeed?: (seed: string, page: number) => string | null;   // #364
  maxSeedPages?: number;     // #364 – default 1 (no pagination)
};
```

### Category slugs

Valid slugs are defined in `src/lib/categories.ts`:
`world`, `politics`, `business`, `health`, `science`, `tech`, `sports`, `culture`,
`entertainment`.

`mapSectionToCategory(section)` (in `providers/shared.ts`) maps free-form strings to slugs.
`categoryFromRules(url, section, rules, fallback)` is the multi-rule variant used by
most providers.

---

## Discovery strategies

### 1. Seed-HTML discovery

The static-HTML path. `discoverProviderUrls` fetches each `seeds` URL, parses `<a href>` tags
via `discoverLinks`, and applies pattern + filter + robots checks. No extra code needed.

**Pagination** (optional): set `maxSeedPages > 1` and provide `paginateSeed`:

```ts
paginateSeed: (seed, page) => `${seed}?page=${page}`,
maxSeedPages: 5,
```

Discovery stops when:
- The requested limit is reached.
- `paginateSeed` returns `null` (no further pages).
- Two consecutive pages yield no new links.
- `maxSeedPages` pages have been fetched for that seed.

Robots checks are applied to **every** paginated seed URL.

### 2. URL extractor (`urlExtractor`) — #360/#380

Providers that have a structured API (RSS, REST, GraphQL) can define an optional
`urlExtractor` hook. When present, `discoverProviderUrls` calls the extractor
**instead of** the seed-HTML crawler.

```ts
urlExtractor: async ({ limit, fetch }) => {
  // `fetch` is injected — use it for all HTTP calls so tests stay network-free
  const xml = await fetch("https://feeds.example.com/rss.xml");
  return parseRssUrls(xml);
},
```

**Post-processing by `discoverProviderUrls`** (always applied):
- Fragment stripping.
- Deduplication.
- Hostname check (`providerForUrl(url)?.key === provider.key`).
- `articleUrlPattern` match.
- `articleUrlFilter` (if defined).
- `isUrlAllowed` robots check.
- `limit` enforcement.

If the extractor **throws**, the error is logged at `warn` level and an empty list is
returned — discovery for that provider degrades gracefully.

#### Extractor fetch signature

```ts
type ExtractorFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<string>;
```

In production, `fetchText` from `src/lib/scraper/fetch.ts` (SSRF-safe, supports GET and POST) is used.
In tests, inject a synchronous stub — no real HTTP needed.

---

## Implemented extractor providers

### BBC News – RSS (`src/lib/scraper/rss.ts`)

Fetches each category's BBC RSS feed (`feeds.bbci.co.uk`). `parseRssUrls` extracts URLs
from `<link>` text nodes and `<guid isPermaLink="true">` elements, strips query strings
and fragments, and deduplicates.

Category → feed mapping defined in `BBC_RSS_FEEDS` inside `src/lib/scraper/providers/bbc.ts`.

### Nautilus – WordPress REST API (`src/lib/scraper/wp-api.ts`)

Paginates through `https://nautil.us/wp-json/wp/v2/posts` (20 per page, up to 5 pages).
`NAUTILUS_WP_CATEGORY_MAP` maps editorial section slugs to WP category IDs.

To verify/update WP category IDs:
```sh
curl https://nautil.us/wp-json/wp/v2/categories?per_page=100 | jq '.[] | {id, slug}'
```

### Aeon – GraphQL (`src/lib/scraper/aeon-graphql.ts`)

POSTs `AEON_ESSAYS_QUERY` to `https://aeon.co/api/graphql` with cursor-based pagination.
Nodes with `type` not in `{essay, Essay, ESSAY, article, Article}` are filtered out.
`AEON_GRAPHQL_ENDPOINT` and `AEON_ESSAYS_QUERY` are exported constants for easy update
when the schema drifts.

---

## Adding a new provider — checklist

Each provider lives in its own file under `src/lib/scraper/providers/`. Adding a
provider means creating that file and registering it in the index — no changes to
any existing provider module are required.

1. **Choose a strategy**: RSS/API/GraphQL → use `urlExtractor`; static HTML → use seeds
   (add `paginateSeed`/`maxSeedPages` if needed).
2. **Create a provider module** in `src/lib/scraper/providers/<key>.ts`:
   - Import helpers from `./shared` (`mapSectionToCategory`, `categoryFromRules`,
     `categoryFromFirstSegment`, `excludes`).
   - Import extractor helpers (e.g. `fetchNautilusUrls`) from the appropriate module.
   - Export a single `Provider` object as the default export.
   - Set all required fields: `key`, `name`, `hostnames`, `seeds`,
     `articleUrlPattern`, `defaultCategory`.
   - Add `articleUrlFilter` to exclude live blogs, video pages, author pages, etc.
   - Add `categoryFor` using `categoryFromRules` or `mapSectionToCategory`.
3. **Register the provider** in `src/lib/scraper/providers/index.ts`:
   - Add an `import` for the new module.
   - Add the imported provider to the `PROVIDERS` array.
4. **Verify `articleUrlPattern`**: test against real URLs (positive and negative):
   ```sh
   node -e "console.log(/YOUR_PATTERN/.test('https://...'))"
   ```
5. **Implement `urlExtractor`** (if applicable):
   - Put helpers in `src/lib/scraper/<name>-<strategy>.ts`.
   - Export a `fetch<Name>Urls(limit, fetchFn)` function for testability.
   - Wrap with `try/catch` — extractor errors must never propagate.
6. **Add tests** (`tests/<provider-key>.test.ts`):
   - Inject fetch with fixture data — no real network.
   - Cover: happy path, pagination, error/degradation, dedup, type filtering.
7. **Run typecheck + tests**:
   ```sh
   npm run typecheck
   npm test
   ```
8. **Dry-run discovery**:
   ```sh
   npm run scrape -- --provider <key> --dry-run --limit 5
   ```
9. **Scrape and inspect**:
   ```sh
   npm run scrape -- --provider <key> --limit 3
   ```
10. **Sync content sources** (first run adds the DB row, operator can enable/disable):
    ```sh
    npm run process -- --all  # or visit /admin/content-sources
    ```

---

## Provider drift runbook

### Symptom: discovery returns 0 links

**Step 1 – Confirm the provider is enabled:**
```sh
# Check the ContentSource row (admin UI or direct DB query):
# /admin/articles → Content Sources
```

**Step 2 – Check robots.txt:**
```sh
curl https://<hostname>/robots.txt | grep -A5 "User-agent: ReadWiseBot"
curl https://<hostname>/robots.txt | grep -A5 "User-agent: \*"
```

**Step 3 – Test `articleUrlPattern` against current URLs:**
```sh
# Fetch the seed page and grep for candidate links:
curl -s https://<seed-url> | grep -oP 'href="[^"]+"' | grep -P '<YOUR_PATTERN>'
```

**Step 4 – For RSS extractors – validate the feed URL:**
```sh
curl -I https://feeds.bbci.co.uk/news/world/rss.xml   # should return 200
curl -s https://feeds.bbci.co.uk/news/world/rss.xml | head -30
```

**Step 5 – For WP API extractors – check the API directly:**
```sh
curl "https://nautil.us/wp-json/wp/v2/posts?per_page=3" | jq '.[].link'
```

**Step 6 – For GraphQL extractors – POST the query manually:**
```sh
curl -s -X POST https://aeon.co/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ articles(section:\"essays\",first:3) { edges { node { url type } } } }"}' | jq .
```
Schema drift (field renamed, query structure changed) is the usual culprit. Update
`AEON_ESSAYS_QUERY` in `src/lib/scraper/aeon-graphql.ts`.

**Step 7 – For HTML providers – check `articleUrlPattern`:**
Major sites occasionally change article URL formats (e.g. Time moved from
`/NNNN/slug/` to `/article/YYYY/MM/DD/slug/`). Update the pattern in the provider's
module under `src/lib/scraper/providers/<key>.ts`.

**Step 8 – Dry-run with verbose output:**
```sh
npm run scrape -- --provider <key> --dry-run --limit 10
```

---

## CLI reference

### Scrape

```sh
# Discover + scrape a provider's articles:
npm run scrape -- --provider <key> [--limit N]

# Scrape all providers:
npm run scrape -- --all [--limit N]

# Scrape specific URLs directly:
npm run scrape -- https://example.com/article-1 https://example.com/article-2

# Offline scrape (HTML from file):
npm run scrape -- --file ./page.html --url https://example.com/article

# Dry-run (discover URLs without scraping):
npm run scrape -- --provider <key> --dry-run [--limit N]

# List registered providers:
npm run scrape -- --list-providers
```

### Process (AI enrichment + publish)

```sh
npm run process -- --all [--include-published] [--limit N] [--tts] [--translate es,fr]
npm run process -- --all --enqueue [--limit N] [--tts] [--translate es,fr]
npm run process -- <article-id-1> <article-id-2>
```

Use `--enqueue` when you want durable worker semantics (locks, retries and
dead-letter handling) instead of inline processing in the current terminal.

### Worker (background continuous processing)

```sh
npm run worker                         # durable Job queue worker
npm run worker -- --once               # drain durable queue then exit
npm run worker -- --interval 30000     # poll every 30 s
```

### Seed (full pipeline: discover → scrape → process)

```sh
npm run seed -- --provider <key> [--limit N]
npm run seed -- --all [--limit 3]
npm run seed -- --no-tts               # skip TTS generation
npm run seed -- --translate es,fr      # include translations
```

---

## Safety guardrails (non-negotiable)

| Concern | Implementation |
|---------|---------------|
| SSRF | `resolveAndPin` in `fetch.ts` — every outbound request validates the resolved IP |
| XSS  | `sanitizeArticleHtml` — applied to all scraped HTML before persistence |
| Body size | `scraperMaxBytes()` cap — streaming abort if response is too large |
| Timeout | `scraperTimeoutMs()` — AbortController shared across all redirect hops |
| robots.txt | `isUrlAllowed` — checked per seed AND per candidate article URL |
| Governance | `isProviderEnabled` — disabled ContentSource rows prevent all crawling |

Extractor `urlExtractor` hooks discover URLs only — they do **not** bypass `scrapeUrl` /
`fetchHtml` for article content. Every article URL still flows through the full
SSRF-protected extraction pipeline.

---

## Testing conventions

Tests live in `tests/` and run with Node's built-in test runner:

```sh
npm test
```

Key patterns for scraper tests:
- Set `process.env.LOG_LEVEL = "error"` at the top of the file (suppresses INFO logs).
- Mock `@/lib/prisma`, `@/lib/content-sources`, `@/lib/scraper/robots` via
  `mock.module(...)` in a `before()` block.
- Inject `fetchHtml` / `extractorFetch` / `isUrlAllowed` / `isProviderEnabled` via
  the `DiscoverDeps` argument to `discoverProviderUrls` — never touch real network.
- For extractor unit tests (`bbc-rss.test.ts`, etc.), call the extractor function
  directly with a mock fetch — no need to go through `discoverProviderUrls`.
- Use inline XML/JSON fixture strings rather than fixture files to keep tests self-contained.
