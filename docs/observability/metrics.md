---
title: "Metrics subsystem"
category: "Observability"
architecture: "Documents in-process metrics registry, recorder helpers, route normalization, and Prometheus export boundary."
design: "Captures current counter/histogram/cache-stat behavior, labels, route grouping, and admin metrics route output."
plan: "Update when metrics registry, recorder helpers, route labels, exporters, or admin metrics endpoints change."
updated: "2026-07-01"
rename: "none"
---

# Metrics subsystem

`src/lib/metrics/` is the in-process metrics layer of the Observability
subsystem. It owns the shared counter/histogram/cache-stat registry, a
Prometheus text-format exporter, per-domain recorder helpers, and route-path
normalisation. The SLO catalog in `src/lib/observability/slo.ts` reads the
snapshot produced here to evaluate product-critical service levels.

For the broader Observability context (logging, tracing, error capture, SLOs)
see [`overview.md`](./overview.md).

---

## Architecture

```
domain recorders ──→ registry (in-process maps) ──→ exporter (Prometheus text)
                                                └──→ SLO evaluator (snapshot)
```

### registry (`src/lib/metrics/registry.ts`)

The single source of mutable state: two `Map` structures (counters and
histograms) and a cache-stats accumulator. Nothing outside this file touches the
maps directly.

Key exports:

| Export | Purpose |
| --- | --- |
| `incCounter(name, help, labels, amount?)` | Increment a counter series by `amount` (default 1). |
| `observeHistogram(name, help, buckets, labels, value)` | Record one observation against a histogram series. |
| `incCacheLookup(name)` / `incCacheMiss(name)` | Track raw lookup and miss counts; hit/miss ratio derived at snapshot time. |
| `getMetricsSnapshot()` | Return an immutable snapshot of all series, sorted by name + labels. |
| `resetMetrics()` | Clear all series (used in tests). |
| `normalizeLabelValue(value, fallback?)` | Lower-case, truncate to 80 chars, replace unsafe chars — keep labels low-cardinality. |
| `normalizeOutcome(value, allowed)` | Coerce to a known outcome string or `"unknown"`. |
| `statusClass(status)` | Map an HTTP status code to its class string, e.g. `201 → "2xx"`. |

**Label safety rule**: user ids, request ids, raw article ids, full URL paths,
prompts, selected text, IPs, and any other unbounded values must **never** appear
as metric labels. Only low-cardinality codes (route groups, outcomes, status
classes, bounded feature codes) are allowed.

Standard histogram bucket sets:

| Constant | Buckets (ms) | Used for |
| --- | --- | --- |
| `API_DURATION_BUCKETS_MS` | 10 … 10 000 | API request latency |
| `AI_DURATION_BUCKETS_MS` | 100 … 60 000 | AI provider call latency |
| `JOB_DURATION_BUCKETS_MS` | 50 … 120 000 | Worker job and job-queue latency |

---

### route-groups (`src/lib/metrics/route-groups.ts`)

`routeGroupFromPath(pathname)` maps a raw request path to a low-cardinality
route-group label:

- Non-API paths → `/other`
- Dynamic segments (UUIDs, CUIDs, numeric ids, known positional slots) →
  `[id]`
- Paths longer than 7 segments → capped with `[...]`

This ensures metric labels never encode user-identifiable ids or unbounded
tokens.

---

### exporter (`src/lib/metrics/exporter.ts`)

`exportMetricsPrometheus()` serialises the current snapshot into the Prometheus
text exposition format (text/plain version 0.0.4). Output is stable for a given
snapshot: counters before histograms, both sorted by name then label string.
Served at `GET /api/admin/metrics` (admin-gated).

---

### recorders (`src/lib/metrics/recorders/`)

Domain-specific wrappers around the registry primitives. Each recorder enforces
its own label contract and hides the raw counter/histogram names.

| Recorder | File | What it records |
| --- | --- | --- |
| API requests | `recorders/api.ts` | `recordApiRequest` — per-route-group request counts and latency histograms. |
| Worker jobs | `recorders/worker.ts` | `recordWorkerJob` — article-processing outcomes, attempt counts, and latency. |
| AI calls | `recorders/ai.ts` | `recordAiCall`, `recordAiRetry` — per-feature call counts, latency, token usage. |
| Cache | `recorders/cache.ts` | `recordCacheLookup`, `recordCacheMiss`, `recordCacheAccess` — hit/miss counts per named cache. |
| Content processing | `recorders/content.ts` | `recordContentProcessingRun`, `recordContentProcessingStep`, `recordIngestionRun` — article pipeline outcomes and step counts. |
| Errors / security | `recorders/security.ts` | `recordErrorCaptured`, `recordSecurityEventMetric` — low-cardinality error and security-event counts. |
| Job queue | `recorders/jobs.ts` | `recordJobQueueEvent`, `recordJobLockAge` — lifecycle events and stale-lock age. |

**Ownership note**: domain recorders exist in the metrics package because they
encode the _signal_ (how to count an event), not the _meaning_ (what the count
implies for a business fact table). The business fact tables (AiInvocation,
AuditLog, Job, AnalyticsEvent, ArticleProcessingStep) remain owned by their
respective domain subsystems — Observability only derives numerical signals
from the same events.

---

## Metric catalogue

The following metric names are currently registered. All are low-cardinality by
design.

| Metric name | Type | Labels | Recorder |
| --- | --- | --- | --- |
| `readwise_api_requests_total` | counter | method, route, status, status_class | api |
| `readwise_api_request_duration_ms` | histogram | method, route, status_class | api |
| `readwise_worker_jobs_total` | counter | outcome, published | worker |
| `readwise_worker_job_attempts_total` | counter | outcome | worker |
| `readwise_worker_job_duration_ms` | histogram | outcome | worker |
| `readwise_ai_calls_total` | counter | feature, outcome, status_class | ai |
| `readwise_ai_call_duration_ms` | histogram | feature, outcome | ai |
| `readwise_ai_tokens_total` | counter | feature, token_type | ai |
| `readwise_ai_retries_total` | counter | feature | ai |
| `readwise_cache_access_total` | counter | cache, outcome (hit/miss) | cache |
| `readwise_content_processing_runs_total` | counter | outcome, published | content |
| `readwise_content_processing_steps_total` | counter | step, status | content |
| `readwise_ingestion_runs_total` | counter | provider, outcome, health | content |
| `readwise_errors_captured_total` | counter | source, severity, alert | security |
| `readwise_security_events_total` | counter | type, severity, status_class, alert | security |
| `readwise_job_queue_events_total` | counter | event, type | jobs |
| `readwise_job_lock_age_ms` | histogram | type | jobs |

---

## Public API

Callers should import from `@/lib/metrics` (the barrel):

```ts
import {
  recordApiRequest,
  recordAiCall,
  recordWorkerJob,
  exportMetricsPrometheus,
  getMetricsSnapshot,
} from "@/lib/metrics";
```

Direct imports from submodules (`@/lib/metrics/registry`, individual recorder
files) are permitted for domain code that only needs a single recorder.

The registry internal (`incCounter`, `observeHistogram`, the raw maps) is
private to the metrics package; external code must not call the primitives
directly — use the typed recorder functions.

---

## Privacy rules for labels

Label values pass through `normalizeLabelValue` which truncates and
sanitises. The recorders additionally enforce:

- **No user ids, request ids, article ids, or session tokens as labels** —
  these belong in the structured log line for correlation, not in the time-series
  dimension.
- **No prompts, selected text, or AI-generated text** in any label.
- **No full URL paths** — only the normalised route group from
  `routeGroupFromPath`.
- **No free-form error messages** — only the fingerprint lives in the log line;
  the metric label is `source` + `severity` only.

These rules align with the security-owned redaction policy (`@/lib/security/redaction`)
applied in the error-capture path. See [`overview.md §Redaction policy`](./overview.md#redaction-policy)
for the full policy description.
