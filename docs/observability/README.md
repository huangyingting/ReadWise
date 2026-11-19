---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Structured logging, tracing, metrics, SLOs, client error reporting, and the investigation workflow."
---

# Observability

Signals that explain how the system behaves. Observability exports and correlates signals; it does not own audit logs, the AI ledger, or analytics events.

Add a document here when the change adds logs, metrics, traces, alerts, or error capture.

## Code ownership

- `src/lib/observability/`, `src/lib/metrics/`
- `src/lib/client-error-reporter.ts`, `src/app/api/client-errors/`
- `src/instrumentation.ts`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Client-error reporting](./client-error-reporting.md) | design | current | Documents browser runtime error ingestion, aggregation, redaction, and alerting boundaries. Captures current client error route behavior, scrubbed metadata, rate limiting, aggregation, and alert thresholds. |
| [Metrics subsystem](./metrics.md) | reference | current | Documents in-process metrics registry, recorder helpers, route normalization, database query timing, and Prometheus export boundary. Captures current counter/gauge/histogram/cache-stat behavior, labels, route grouping, and admin metrics route output. |
| [Observability subsystem](./overview.md) | reference | current | Documents tracing, logging, error aggregation, metrics, SLOs, and investigation workflow boundaries. Captures current instrumentation, request IDs, provider fallbacks, alerting seams, dashboards, and triage guidance. |

<!-- END GENERATED: docs-index -->
