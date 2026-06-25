# Observability: tracing, error aggregation & SLOs

This document covers the three observability pillars added in Epic **RW-E006**:

- **RW-032** — distributed tracing with OpenTelemetry
- **RW-033** — backend-agnostic error aggregation
- **RW-034** — SLIs / SLOs for product-critical flows

Everything here is **graceful and opt-in**: with nothing configured the app
behaves exactly as before — no collector, no extra dependency at runtime, no
slower build. You turn each pillar on with environment variables.

---

## 1. Distributed tracing (RW-032)

### How it works

| Piece | File | Role |
| --- | --- | --- |
| SDK bootstrap | `src/instrumentation.ts` → `src/lib/observability/tracing-node.ts` | Next.js calls `register()` once per server process; we start the OpenTelemetry **Node SDK** there, but only in the Node.js runtime and only when configured. |
| API-only helpers | `src/lib/observability/tracing.ts` | `withSpan` / `startChildSpan` / `setSpanAttributes`. Safe to import anywhere — the OTel API is a **no-op** until an SDK is registered, so these cost nothing when tracing is off. |

Spans are created around the major flows:

- **API requests** — `src/lib/api-handler.ts` wraps every handler in a
  `"<METHOD> <routeGroup>"` span and records unhandled errors on it.
- **AI provider calls** — `src/lib/ai.ts` adds a child `ai.chat_completion`
  span around the Azure OpenAI request.
- **Worker jobs** — `src/lib/worker/` wraps article processing
  (`worker.process_article`) and queue jobs (`worker.job`).
- **Scraper fetches** — `src/lib/scraper/extract.ts` wraps the provider fetch
  (`scraper.fetch`) with the **hostname only**.

The ambient **request id** (from `src/lib/observability/logger.ts`’s `AsyncLocalStorage`) is
set as the `readwise.request_id` span attribute so a trace lines up with the
structured logs.

### Privacy

Span attributes go through an **allow-list** (`sanitizeAttributes` in
`src/lib/observability/tracing.ts`). Only low-cardinality, content-free keys
(`readwise.feature`, `readwise.route`, `readwise.host`, status, ids, …) survive;
any other key — or any object/array value — is dropped. **Article text,
selected text, and prompts can never reach a span.**

### Enabling it

Tracing turns on when **either**:

| Variable | Effect |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) | Export spans over OTLP/HTTP to that collector. |
| `TRACING_ENABLED=true` | Enable tracing with no endpoint → falls back to a **console** span exporter (local debugging). |

Optional: `OTEL_SERVICE_NAME` (default `readwise`), `APP_VERSION` for the
service version on the resource.

### Local setup with Jaeger

Run an all-in-one Jaeger that accepts OTLP/HTTP on `:4318`:

```bash
docker run --rm -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Point the app at it and start the server / worker:
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_SERVICE_NAME=readwise
npm run dev    # or: npm run worker
```

Open the Jaeger UI at <http://localhost:16686>, pick the `readwise` service, and
search for traces. AI and scraper calls appear as child spans.

> No collector? Just `export TRACING_ENABLED=true` to print spans to the console
> instead. In CI and in normal local dev (neither var set) tracing stays off.

---

## 2. Error aggregation (RW-033)

### How it works

`src/lib/observability/errors.ts` exposes a single seam — `captureError(error,
context)` — that every error path funnels through:

- **Server errors** — the api-handler’s unhandled-error path calls it.
- **Worker failures** — `runWorker` / `runJobWorker` call it (dead-lettered
  jobs are reported as `fatal` so they always alert).
- **Client errors** — `POST /api/client-errors` (fed by
  `ClientErrorReporter.tsx` + `global-error.tsx`, with their existing
  throttle/dedup) calls it.

Each call:

1. computes a stable **fingerprint** = error name + normalized message (digits
   and hex ids masked so occurrences group) + top stack frame,
2. enriches with **release/version** (`APP_VERSION` / `npm_package_version`),
   **environment** (`NODE_ENV`), **route**, **request id**, and **user id**
   (pulled from the logger’s request context when not supplied),
3. **redacts** content — sensitive keys (`content`, `prompt`, `selection`,
   `token`, `authorization`, …) are replaced with `[redacted]`, emails/long
   tokens in free text are masked, and nested objects are collapsed to
   `[object]`,
4. increments the `readwise_errors_captured_total` metric, and
5. fires a high-frequency / high-severity **alert hook** past a threshold.

### Backend-agnostic by design

The **default sink** writes a structured `error.captured` log line (so errors
land in the same searchable logs) and the default **alert hook** writes an
`error.alert` line. To forward to a real provider (Sentry, an OTLP errors
pipeline, …) call `setErrorSink(...)` / `setAlertHook(...)` from a server-only
bootstrap — **no provider dependency is hard-added**. Select a provider name via
`ERROR_REPORTING_PROVIDER` (default `log`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ERROR_REPORTING_PROVIDER` | `log` | Provider label / seam selector. |
| `ERROR_ALERT_THRESHOLD` | `10` | Occurrences of one fingerprint that trigger the alert hook. |
| `APP_VERSION` | package version | Release tag on every captured error. |

### Investigating an error: request id → logs → trace

1. The client/API response carries an **`x-request-id`** header (and the JSON
   error body includes `requestId`).
2. Search the structured logs for that id:
   `requestId="<id>"`. You’ll see `request.start` → `request.complete` /
   `request.unhandled_error`, plus any `error.captured` line with the
   **fingerprint**, **release**, **route**, and **userId**.
3. Search by **fingerprint** to see every occurrence of the same error group and
   whether an `error.alert` fired.
4. If tracing is enabled, the same request id is on the span
   (`readwise.request_id`) — open the trace in Jaeger to see the AI/scraper
   child spans and where time was spent.

---

## 3. SLIs & SLOs (RW-034)

`src/lib/observability/slo.ts` is the single source of truth: an SLI **catalog**
(`SLI_CATALOG`) plus an evaluator (`evaluateSlos`) that computes the current
status from the in-process metrics snapshot (`src/lib/metrics/`). It is
surfaced at **`GET /api/admin/slo`** (admin-gated) alongside the existing
Prometheus endpoint at `GET /api/admin/metrics`.

SLIs are split into **interactive** (user-facing) and **background**
(enrichment) classes, per the acceptance criteria.

### Catalog & initial targets

| Flow | SLI | Class | Source metric | Initial target |
| --- | --- | --- | --- | --- |
| Sign-in | Availability (non-5xx) | interactive | `readwise_api_requests_total` `/api/auth/*` | 99.5% |
| Dashboard load | Latency < 1000ms | interactive | `readwise_api_request_duration_ms` `/api/feed` | 95% |
| Article reader load | Latency < 2500ms | interactive | `readwise_api_request_duration_ms` `/api/reader/*` | 90% |
| Reading progress save | Latency < 500ms | interactive | `readwise_api_request_duration_ms` `/api/reader/[id]/progress` | 95% |
| Dictionary lookup | Latency < 2500ms | interactive | `readwise_api_request_duration_ms` `/api/dictionary` | 90% |
| AI feature response | Availability (success/total) | interactive | `readwise_ai_calls_total` | 95% |
| AI feature response | Latency < 10s | interactive | `readwise_ai_call_duration_ms` | 90% |
| Article import | Availability (non-5xx) | interactive | `readwise_api_requests_total` `/api/articles/import` | 95% |
| Background processing | Job success (success/total) | background | `readwise_worker_jobs_total` | 90% |
| Background processing | Latency < 30s | background | `readwise_worker_job_duration_ms` | 90% |

Notes:

- **Latency SLIs** are measured as “fraction of requests within the threshold”
  using the histogram buckets (robust, no percentile estimation needed).
- **Availability** counts non-5xx for API SLIs; the AI/worker SLIs use
  success / (success + error), excluding `unconfigured`/`aborted`/`missing`.
- Sign-in coverage is **partial**: NextAuth owns its own route handler, so its
  requests are not all routed through the metrics wrapper. The SLI is defined;
  fuller coverage (and true page-load RUM for dashboard/reader) is future work.
- An SLI with no observations yet evaluates to **`no_data`**, never a breach.

These targets are intentionally conservative starting points — **refine with
production data.**

### Breach review & alerting procedure

1. **Detect.** Poll `GET /api/admin/slo` (or wire it into a scheduled check /
   dashboard). Each SLI reports `status` (`ok` / `breaching` / `no_data`),
   `value`, `objective`, and `sampleCount`.
2. **Triage.** For a breaching interactive SLI, pull the matching route group’s
   `readwise_api_*` metrics and recent `error.captured` lines; for AI/worker
   SLIs, inspect `readwise_ai_calls_total` / `readwise_worker_jobs_total` by
   outcome.
3. **Correlate.** Use a failing request’s **request id → logs → trace** (see
   §2) to find the slow/erroring span.
4. **Act & record.** Mitigate (scale, fix, disable a degraded provider — most AI
   paths already degrade gracefully), then note the breach and whether the
   target needs adjustment. Treat repeated breaches of the same SLI as a signal
   to revisit the target or the underlying flow.

---

## Environment variable summary

| Variable | Pillar | Default | Effect |
| --- | --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | tracing | unset | Enable OTLP export to a collector. |
| `TRACING_ENABLED` | tracing | unset | Enable tracing (console exporter when no endpoint). |
| `OTEL_SERVICE_NAME` | tracing | `readwise` | Service name on spans. |
| `ERROR_REPORTING_PROVIDER` | errors | `log` | Error sink / provider selector. |
| `ERROR_ALERT_THRESHOLD` | errors | `10` | Per-fingerprint alert threshold. |
| `APP_VERSION` | tracing + errors | package version | Release tag. |
