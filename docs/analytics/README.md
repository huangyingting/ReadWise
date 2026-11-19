---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Product analytics event stream and retention, domain reporting read models, and tenant reporting privacy bounds."
---

# Analytics

Product events and reporting. Analytics may aggregate, but source facts stay owned by their domains.

Add a document here when the change adds or changes an analytics event, a reporting query, or what teachers and admins can see about learners.

## Code ownership

- `src/lib/analytics/`
- `src/app/admin/analytics/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Domain reporting and read models](./domain-reporting.md) | design | current | Documents domain-owned reporting read models and their separation from the product analytics event stream. Captures current aggregation boundaries, visibility rules, privacy limits, and report ownership. |
| [Product analytics (Epic RW-E010)](./product-analytics.md) | design | current | Documents the append-only product analytics event stream, retention helpers, and privacy boundaries. Captures current event schemas, sanitizer behavior, dashboard/export rules, and metadata-only constraints. |
| [Tenant reporting privacy boundaries](./tenant-reporting-privacy.md) | design | current | Documents tenant/classroom reporting visibility boundaries and aggregate-vs-learner data ownership. Captures current teacher/admin visibility, retention/export expectations, and privacy rules for classroom analytics. |

<!-- END GENERATED: docs-index -->
