---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "How articles enter and are governed: scraper providers and incremental discovery, extraction quality, the article library access policy, content policy, reporting, and legal content."
---

# Content ingestion and policy

Content Ingestion (providers, discovery, extraction, SSRF and robots controls) and the Article Library (visibility, lifecycle, moderation, rights). ADR [0002](../architecture/0002-article-visibility-and-access-service.md) governs article access.

Add a document here when the change affects how articles are discovered, extracted, stored, moderated, or made visible.

## Code ownership

- `src/lib/scraper/` (providers, incremental discovery ledger)
- `src/lib/article-library/`, `src/lib/content-pipeline/`, `src/lib/moderation/`
- `src/app/admin/articles/`, `src/app/admin/discovery-sources/`, `src/app/admin/candidates/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Article library design](./article-library.md) | design | current | Documents Article Library visibility, status, ownership, moderation, and access-policy boundaries. Captures current article lifecycle, public/private listing behavior, admin operations, and safety/privacy constraints. |
| [Article quality cleanup and duplicate analysis design](./article-quality-cleanup-design.md) | design | proposed | Documents content-quality cleanup analysis and duplicate-detection design around scraped public-library articles. Captures proposed/current cleanup signals, review workflow, safety limits, and operator-facing analysis approach. |
| [Content policy: sources, rights & takedown](./content-policy.md) | policy | current | Documents source governance, rights metadata, review, takedown, and provider-health boundaries. Captures current policy workflow, source controls, moderation actions, and privacy-safe metadata handling. |
| [Content Reporting](./content-reporting.md) | design | current | Documents user content-reporting, ContentReport schema, and admin moderation queue boundaries. Captures current report reasons/statuses, reader/admin APIs, deduplication, audit actions, and privacy rules. |
| [Content Extraction Quality Checks](./extraction-quality.md) | design | current | Documents extraction-quality signals, classifier/heuristic boundaries, and scraper drift triage. Captures current quality scoring, rejection/flag behavior, provider counters, and review workflow. |
| [Incremental provider scraping design](./incremental-provider-scraping-design.md) | design | current | Stateful incremental provider ingestion (Phases 1.1-3.5): discovery ledger data model, URL identity, leased scheduling, baseline/shadow lifecycle, rate governor, candidate review and source trust, backfill, force-rescrape, and canonical-conflict and deleted-article governance. |
| [Legal and Static Content Governance](./legal-content.md) | design | current | Documents legal/static content ownership and release/update boundaries. Captures current responsibilities for terms, privacy, static routes, review cadence, and change control. |
| [Scraper Provider Guide](./scrapers.md) | design | current | Documents scraper providers, discovery/extraction pipeline, SSRF/robots controls, source health boundaries, scrape-review feedback retention, and operator guidance. |

<!-- END GENERATED: docs-index -->
