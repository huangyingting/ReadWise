# Incident response & SLO breach runbooks

This document gives on-call operators concrete steps for detecting, triaging,
mitigating, and reviewing production incidents. Procedures are organized around
the [SLO catalog](#slo-catalog-quick-reference) defined in
`src/lib/observability/slo-catalog.ts`, the observability signals described in
[`docs/observability/overview.md`](../observability/overview.md), and the job
queue operations described in
[`docs/operations/admin-operations.md`](./admin-operations.md).

---

## Severity levels

| Level | Definition | Response target | Example |
| ----- | ----------- | --------------- | ------- |
| **SEV-1** | Complete outage or data integrity risk for all users | Immediate (< 15 min) | Sign-in endpoint down; database unreachable; all jobs dead-lettering |
| **SEV-2** | Significant degradation for many users; interactive SLI breaching | < 1 hour | AI availability below 80%; reader API P95 > 10 s; import failing |
| **SEV-3** | Partial or background-only degradation; single feature impaired | < 4 hours | Push delivery failing; scraper single-provider failure; worker latency high |
| **SEV-4** | Cosmetic issue or low-impact anomaly; no SLO breach | Next business day | Elevated client error rate for one browser; minor SLI degradation within budget |

Escalate immediately when:
- A SEV-2 is not improving after 30 minutes of mitigation.
- An SLI breaches its objective for more than 15 consecutive minutes.
- Any `error.alert` log line fires repeatedly (threshold: `ERROR_ALERT_THRESHOLD`
  occurrences of the same fingerprint — default 10).

---

## On-call response steps

Follow this sequence for every incident regardless of severity.

### 1. Confirm the signal

```
GET /api/admin/slo       # current SLI values, objective, status per key
GET /api/admin/metrics   # raw Prometheus counters and histograms
```

Both endpoints are admin-gated. Each `/api/admin/slo` response includes:
`evaluatedAt`, `total`, `ok`, `breaching`, `noData`, and the full `slis` array
with `key`, `value`, `objective`, `status`, and `sampleCount`.

Check `sampleCount > 0` before acting — an SLI with `status: "no_data"` means
the process has not served enough traffic to measure yet, not that it is failing.

### 2. Identify the affected SLI(s)

Map the breaching SLI key to the impacted flow using the
[SLO catalog quick reference](#slo-catalog-quick-reference) below.
Note the category (`interactive` vs. `background`) — interactive breaches are
higher urgency.

### 3. Triage with logs

Every structured log line carries `requestId`, `route`, `userId`, and
`message`. Filter patterns:

| Goal | Log filter |
| ---- | ---------- |
| Follow one request | `requestId="<id>"` |
| Find all captured errors for a route | `message="error.captured" route="/api/reader/*"` |
| Find alert-level errors | `message="error.alert"` |
| Find worker failures | `message="error.captured" source="worker"` |
| Find dead-lettered jobs | `message="error.captured" severity="fatal"` |

The `error.captured` line includes `fingerprint`, `release`, `route`, `userId`,
and all non-sensitive context. The `error.alert` line fires when the same
fingerprint exceeds `ERROR_ALERT_THRESHOLD` within the process lifetime.

### 4. Correlate with traces (when enabled)

If `OTEL_EXPORTER_OTLP_ENDPOINT` or `TRACING_ENABLED=true` is set:

1. Find the `readwise.request_id` attribute on the root span in Jaeger (or your
   collector UI).
2. AI calls appear as child spans named `ai.chat_completion`.
3. Scraper fetches appear as child spans named `scraper.fetch` (hostname only —
   no article content).
4. Worker jobs appear as `worker.process_article` and `worker.job` spans.

### 5. Mitigate

Choose the appropriate [playbook](#subsystem-playbooks) below, apply the fix,
then re-poll `/api/admin/slo` to confirm the SLI recovers.

### 6. Communicate

Notify stakeholders using the severity table as a guide. Include:
- What is affected (SLI key + user-facing flow).
- Current value vs. objective.
- Mitigation applied or in progress.
- Next update time.

### 7. Record

Open a post-incident review using the [template](#post-incident-review-template)
at the bottom of this document.

---

## SLO catalog quick reference

These SLIs are defined in `src/lib/observability/slo-catalog.ts`. Values shown
are the initial conservative targets; adjust after collecting production data.

| SLI key | Flow | Category | Kind | Target | Source metric / filter |
| ------- | ---- | -------- | ---- | ------ | ---------------------- |
| `sign_in` | Sign-in | interactive | availability | ≥ 99.5% non-5xx | `readwise_api_requests_total` route prefix `/api/auth` |
| `dashboard_load` | Dashboard load | interactive | latency < 1000 ms | ≥ 95% | `readwise_api_request_duration_ms` route `/api/feed` |
| `reader_load` | Article reader | interactive | latency < 2500 ms | ≥ 90% | `readwise_api_request_duration_ms` route prefix `/api/reader/` |
| `progress_save` | Progress save | interactive | latency < 500 ms | ≥ 95% | `readwise_api_request_duration_ms` route `/api/reader/[id]/progress` |
| `dictionary_lookup` | Dictionary lookup | interactive | latency < 2500 ms | ≥ 90% | `readwise_api_request_duration_ms` route `/api/dictionary` |
| `ai_feature_response` | AI feature | interactive | availability | ≥ 95% success/(success+error) | `readwise_ai_calls_total` |
| `ai_feature_latency` | AI feature | interactive | latency < 10 000 ms | ≥ 90% | `readwise_ai_call_duration_ms` outcome=success |
| `import_success` | Article import | interactive | availability | ≥ 95% non-5xx | `readwise_api_requests_total` route `/api/articles/import` |
| `worker_processing` | Background processing | background | availability | ≥ 90% success/(success+failed) | `readwise_worker_jobs_total` |
| `worker_latency` | Background processing | background | latency < 30 000 ms | ≥ 90% | `readwise_worker_job_duration_ms` |

> **Coverage note:** Sign-in coverage is partial — NextAuth owns its own route
> handler so not all auth requests flow through the metrics wrapper. The SLI is
> defined; fuller coverage is future work.

**Reading the Prometheus output** (`GET /api/admin/metrics`):

```
# COUNTER — total requests to /api/feed broken out by status class
readwise_api_requests_total{method="GET",route="/api/feed",status="200",status_class="2xx"} 4821

# HISTOGRAM — latency buckets for /api/reader/* (cumulative counts per le boundary)
readwise_api_request_duration_ms_bucket{method="GET",route="/api/reader/[id]",status_class="2xx",le="2500"} 9103
readwise_api_request_duration_ms_count{...} 9980

# AI calls by feature and outcome
readwise_ai_calls_total{feature="translate",outcome="success",status_class="2xx"} 1220
readwise_ai_calls_total{feature="translate",outcome="error",status_class="5xx"} 18

# Worker jobs by outcome
readwise_worker_jobs_total{outcome="success",published="true"} 702
readwise_worker_jobs_total{outcome="failed",published="false"} 12

# Job queue events
readwise_job_queue_events_total{event="dead_letter",type="article_process"} 5
readwise_job_queue_events_total{event="retry",type="article_process"} 47
```

---

## SLO breach response

### Detection

Poll `GET /api/admin/slo` on a regular schedule (e.g., every 5 minutes via a
cron or uptime monitor). A breach is confirmed when:
- `status: "breaching"` for one or more SLI keys, **and**
- `sampleCount > 0` (the SLI has observed traffic).

Treat a sustained breach (≥ 2 consecutive poll cycles) as a confirmed incident.

### Triage matrix

| Breaching SLI key(s) | First check | Likely cause |
| -------------------- | ----------- | ------------ |
| `sign_in` | `readwise_api_requests_total` 5xx rate for `/api/auth*`; NextAuth logs | Auth provider down; session store issue; DB connection |
| `dashboard_load` | `readwise_api_request_duration_ms` for `/api/feed`; DB slow-query logs | Slow DB query; missing index; cold start |
| `reader_load`, `progress_save`, `dictionary_lookup` | `/api/reader/*` and `/api/dictionary` latency histograms; AI call latency | AI provider slow; DB query regression; cache miss storm |
| `ai_feature_response`, `ai_feature_latency` | `readwise_ai_calls_total` outcome=error; AI provider status | AI provider outage/rate-limit; bad deployment config |
| `import_success` | `readwise_api_requests_total` 5xx for `/api/articles/import`; scraper logs | Scraper provider down; DB write error |
| `worker_processing`, `worker_latency` | `readwise_worker_jobs_total` outcome=failed; `readwise_job_queue_events_total` event=dead_letter | Worker process stopped; provider transient failure; DB unavailable |

### Mitigation checklist

1. **Confirm the worker is running** (for background SLIs): check process status;
   restart with `npm run worker` if absent.
2. **Check for dead-lettered jobs**: open `/admin/jobs` → dead-letter view;
   inspect `errorHistory` on a sample; address root cause before bulk-retrying.
3. **Verify provider config** (for AI/scraper SLIs): ensure `OPENAI_API_KEY` /
   `AZURE_OPENAI_*` env vars are set and valid; the AI path degrades gracefully
   when `outcome: "unconfigured"` (those are excluded from the SLI denominator).
4. **Scale or restart the application** if memory or file-descriptor exhaustion
   is suspected (check process RSS and open-file counts).
5. **Roll back** the most recent deployment if the breach correlates with a
   release boundary (`APP_VERSION` label in error logs).
6. **Re-poll** `/api/admin/slo` after mitigation; confirm `status` transitions
   back to `"ok"`.

---

## Subsystem playbooks

### PB-1 — AI provider outage or degradation

**Signals**
- `ai_feature_response` breaching (`readwise_ai_calls_total` outcome=error rising).
- `ai_feature_latency` breaching (`readwise_ai_call_duration_ms` p90 > 10 s).
- `readwise_ai_retries_total` increasing rapidly.
- `error.captured` lines with `route="/api/reader/*"` and AI-related fingerprints.

**Triage**

```
# From /api/admin/metrics — count error outcomes by feature
readwise_ai_calls_total{outcome="error",...}
readwise_ai_calls_total{outcome="unconfigured",...}   # config missing — not a provider issue
readwise_ai_retries_total{...}
```

1. Check the AI provider's public status page (Azure OpenAI / OpenAI).
2. Search logs: `message="error.captured" route="/api/reader/*"` — look for
   HTTP 429 (rate limit) or 5xx status codes in the fingerprint context.
3. Check `outcome="unconfigured"` — if non-zero and rising, env vars are missing
   or wrong after a deploy.

**Mitigation**

- **Rate-limit (429):** Reduce request rate; increase retry backoff; wait for
  quota reset. The app retries automatically — watch `readwise_ai_retries_total`.
- **Provider outage:** No immediate fix. AI features degrade gracefully (they
  return a fallback or empty response); users can still read articles.
  Communicate that AI-powered features are degraded.
- **Misconfigured (unconfigured):** Restore `OPENAI_API_KEY` /
  `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_DEPLOYMENT` env vars and redeploy.
- **Dead-lettered AI_REBUILD jobs:** After provider recovers, open `/admin/jobs`
  and bulk-retry `DEAD_LETTER` jobs of type `AI_REBUILD`. Monitor
  `readwise_worker_jobs_total` outcome=success to confirm recovery.

**Recovery check:** `ai_feature_response.status` = `"ok"` at `/api/admin/slo`.

---

### PB-2 — Database unavailable or severely degraded

**Signals**
- Multiple interactive SLIs breaching simultaneously (`sign_in`, `dashboard_load`,
  `reader_load`, `import_success`).
- High 5xx rate across all route groups in `readwise_api_requests_total`.
- Worker jobs failing with `kind: "unknown"` errors in `errorHistory`.
- `readwise_job_queue_events_total{event="dead_letter"}` spiking across all job types.

**Triage**

1. Check the database host/connection string (`DATABASE_URL`).
2. Look for `"error.captured"` log lines with `PrismaClientKnownRequestError` or
   `connection refused` in the fingerprint message.
3. Check `/api/health` — if the health check returns non-200, the DB is the most
   likely cause. See [`docs/platform/health-readiness.md`](../platform/health-readiness.md)
   for health endpoint details.
4. On PostgreSQL: check connection pool saturation, long-running transactions, and
   lock waits via `pg_stat_activity`.

**Mitigation**

- **Connection exhausted:** Reduce connection pool size (`DATABASE_POOL_MAX`);
  restart the application process to release leaked connections.
- **DB host unreachable:** Restore network path or fail over to a replica per
  your infrastructure runbook.
- **Disk full / storage issue:** Free disk space; checkpoint WAL; alert DB team.
- **Post-recovery:** Worker locks expire automatically after `DEFAULT_LOCK_TTL_MS`
  (10 minutes). Start or restart the worker (`npm run worker`) once the DB is
  healthy; jobs will self-recover. Do not mass-cancel active jobs — let the lock
  TTL expire first.

See also [`docs/platform/database-runbooks.md`](../platform/database-runbooks.md).

---

### PB-3 — Job queue backlog or dead-letter spike

**Signals**
- `worker_processing` or `worker_latency` SLIs breaching.
- `readwise_job_queue_events_total{event="dead_letter"}` rising.
- `readwise_job_queue_events_total{event="retry"}` consistently high.
- `/admin/jobs` shows large `PENDING` or `FAILED` count.
- `readwise_job_stale_lock_age_ms` reporting old lock ages (worker crashed).

**Triage**

1. Open `/admin/jobs` — check counts by status and type.
2. Inspect `errorHistory` on a sample of `DEAD_LETTER` jobs. The `kind` field
   indicates root cause:
   - `validation` / `missing` / `permission`: data/config problem — permanent.
   - `provider` / `unknown`: transient — safe to retry after fixing the provider.
3. Check the worker process is running. If absent, stale `CLAIMED`/`RUNNING`
   locks will be auto-recovered after 10 minutes on the next worker start.
4. Look at `readwise_worker_job_attempts_total` — high attempt counts for a job
   type indicate repeated transient failures.

**Mitigation**

- **Worker stopped:** Restart with `npm run worker`. Stale locks recover
  automatically on the next claim cycle.
- **Transient provider failures (type: provider/unknown):** Fix the root cause
  (see PB-1 for AI, PB-5 for storage, PB-4 for scraper). Then bulk-retry from
  `/admin/jobs` dead-letter view.
- **Permanent failures (type: validation/missing):** Do not retry blindly.
  Diagnose the data problem first, fix it, then retry individual jobs.
- **Stuck `CLAIMED`/`RUNNING` jobs:** If a job has been in this state longer
  than 10 minutes and the worker is running, cancel it via the admin UI and
  retry fresh.
- **Large backlog — drain quickly:** Ensure the worker is running; for very
  large backlogs use `npm run process -- --all --limit <N> --enqueue` to
  confirm the candidate set, then let the worker drain. See
  [admin-operations.md § Backfill](./admin-operations.md).

---

### PB-4 — Scraper / content ingestion failure

**Signals**
- `import_success` SLI breaching.
- `readwise_api_requests_total{route="/api/articles/import",status_class="5xx"}` rising.
- `ARTICLE_INGEST` jobs in `DEAD_LETTER` at `/admin/jobs`.
- `error.captured` lines with fingerprints mentioning scraper provider names or
  network errors.

**Triage**

1. Search logs for `message="error.captured" route="/api/articles/import"` —
   note the fingerprint and provider name in context (hostname appears on
   `scraper.fetch` spans).
2. Open `/admin/sources` — check provider health counters and enabled status.
3. Inspect dead-letter `ARTICLE_INGEST` jobs for `errorHistory` — look for
   HTTP 403/429/503 from the content source, or DNS/timeout errors.

**Mitigation**

- **Single provider blocked/rate-limited:** Disable that provider in
  `/admin/sources` temporarily. Other providers remain active. Re-enable after
  the block clears.
- **All providers failing:** Check network egress from the application host.
  Verify no upstream IP block or DNS issue.
- **Permanent content-not-found errors (`kind: missing`):** These dead-letter
  correctly; do not retry. Inform users that specific URLs cannot be imported.
- **After fix:** Retry `DEAD_LETTER` `ARTICLE_INGEST` jobs from `/admin/jobs`.

---

### PB-5 — Storage / media failure (speech / TTS)

**Signals**
- `TTS_GENERATE` jobs failing or dead-lettering at `/admin/jobs`.
- `readwise_job_queue_events_total{event="dead_letter",type="tts_generate"}` rising.
- `error.captured` lines with storage or speech provider errors.
- Users report missing or broken audio in the reader.

**Triage**

1. Open `/admin/jobs` → filter by type `TTS_GENERATE`, status `DEAD_LETTER`.
2. Inspect `errorHistory` — look for `kind: provider` with speech service HTTP
   errors (401, 429, 503) or object-storage write errors.
3. Verify speech provider environment variables are set (see
   [`docs/operations/tts-jobs.md`](./tts-jobs.md) for TTS-specific guidance).
4. Check object-storage reachability (S3-compatible endpoint, bucket permissions,
   credentials).

**Mitigation**

- **Speech provider auth failure (401):** Rotate and redeploy the API key.
- **Speech provider quota (429):** Wait for quota reset; reduce concurrency if
  configurable. The retry policy allows up to 3 attempts with exponential backoff.
- **Storage write error:** Verify bucket exists and credentials have write
  permission. Restore connectivity before retrying jobs.
- **After fix:** Retry `DEAD_LETTER` `TTS_GENERATE` jobs from the admin UI.
  Monitor `/admin/jobs` for the `DEAD_LETTER` count to fall.

---

### PB-6 — Push notification delivery failure

**Signals**
- `PUSH_REMINDER` jobs failing or dead-lettering.
- `readwise_job_queue_events_total{event="dead_letter",type="push_reminder"}` rising.
- Users report not receiving reminder notifications.

**Triage**

1. Open `/admin/jobs` → filter by type `PUSH_REMINDER`.
2. Inspect `errorHistory` on dead-letter jobs — look for push provider HTTP
   errors (authentication failure, invalid device token, provider unavailable).
3. Check push notification provider credentials are configured and valid. See
   [`docs/platform/push-notifications.md`](../platform/push-notifications.md).

**Mitigation**

- **Provider auth failure:** Rotate push credentials and redeploy.
- **Invalid device tokens:** These are permanent errors — dead-lettering is
  correct. The system will attempt to clean up invalid tokens. Do not retry.
- **Provider outage:** Wait for the provider to recover. Retry `DEAD_LETTER`
  `PUSH_REMINDER` jobs after recovery (up to 3 attempts in the retry policy).
- **Notification is time-sensitive (reading reminders):** Missed reminders are
  generally acceptable to drop rather than delivering late. Discuss with product
  before bulk-retrying stale reminders.

---

### PB-7 — Client error spike

**Signals**
- `readwise_errors_captured_total{source="client",alert="true"}` appearing in
  logs (`error.alert` lines).
- `readwise_errors_captured_total{source="client"}` counter growing rapidly in
  `/api/admin/metrics`.
- User-facing JavaScript errors reported via `POST /api/client-errors`.

**Triage**

1. Search logs for `message="error.alert" source="client"` — note the
   `fingerprint` value.
2. Search for `message="error.captured" fingerprint="<value>"` to see the full
   error context (message, stack top frame, route/path, release version).
3. Correlate with a recent deployment: compare `release` in error lines with the
   previous `APP_VERSION`.

**Mitigation**

- **Regression from a recent release:** Roll back the deployment if the error
  rate is high and SLI values are degrading.
- **Browser-specific issue:** Note the `clientSource` and `url` fields in the
  `error.captured` log line. Scope the fix to the affected component.
- **Third-party script or CDN issue:** If the stack traces point to external
  scripts, the fix is outside application code. Monitor and communicate.
- **Rate-limited false quiet:** The client reporter throttles and deduplicates
  before sending — a spike that silences may still represent a larger real
  volume. Compare `readwise_errors_captured_total` trend across time.

---

### PB-8 — Auth / sign-in failure

**Signals**
- `sign_in` SLI breaching (< 99.5% non-5xx for `/api/auth/*`).
- Users unable to log in or being logged out unexpectedly.
- `readwise_api_requests_total{route="/api/auth/*",status_class="5xx"}` rising.

**Triage**

1. Check `/api/auth/session` and `/api/auth/providers` for correct responses.
2. Search logs: `requestId` from a failing login attempt → look for
   `request.unhandled_error` and the downstream `error.captured` line.
3. Verify `NEXTAUTH_SECRET`, OAuth provider credentials, and `NEXTAUTH_URL` env
   vars are set correctly (check for blank values after a deploy).
4. Confirm the database is reachable — NextAuth session storage depends on it.

**Mitigation**

- **Missing/rotated OAuth credentials:** Restore OAuth client ID/secret and
  redeploy.
- **`NEXTAUTH_SECRET` mismatch:** If the secret changed, existing sessions are
  invalidated. This is correct behavior. Restore the original secret if
  unintentional.
- **DB unavailable:** Follow PB-2 first; auth will recover automatically.
- **Session cookie domain mismatch:** Verify `NEXTAUTH_URL` matches the
  deployment hostname exactly.

---

## Post-incident review template

Complete a review for every SEV-1 and SEV-2 incident within 48 hours. SEV-3
reviews are recommended when the incident was novel or recurring.

```markdown
## Post-incident review — <title>

**Date:** YYYY-MM-DD
**Severity:** SEV-N
**Duration:** HH:MM (detected at HH:MM UTC → resolved at HH:MM UTC)
**Incident commander:**
**Participants:**

### Impact
- User-facing flows affected:
- SLI(s) breached: <key> (value X% vs. objective Y%)
- Approximate user count impacted:

### Timeline
| Time (UTC) | Event |
| ---------- | ----- |
| HH:MM | Signal detected (SLI breach / alert) |
| HH:MM | On-call paged |
| HH:MM | Triage started |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | SLI recovered to "ok" |
| HH:MM | Incident closed |

### Root cause
<!-- Describe what failed and why. Be specific — cite metric values,
     log fingerprints, and job IDs without including article text,
     user-private content, or secrets. -->

### Mitigation
<!-- What was done to restore service. -->

### Detection gap
<!-- Was the signal caught promptly? Should a new alert or SLI be added? -->

### Action items
| Action | Owner | Due |
| ------ | ----- | --- |
| | | |

### SLO notes
<!-- Was the objective breach within an acceptable budget or a true regression?
     Should the target or measurement window be adjusted? -->
```

---

## Appendix — observability quick reference

### Key admin endpoints

| Endpoint | Purpose |
| -------- | ------- |
| `GET /api/admin/slo` | Current SLI status for all 10 catalog entries |
| `GET /api/admin/metrics` | Raw Prometheus counters and histograms |
| `GET /api/admin/stats` | System overview counts |
| `/admin/jobs` | Job queue dashboard — status, dead-letter, retry, cancel |
| `/admin/analytics/ai` | AI invocation ledger and processing health |
| `/admin/security` | Security events and audit log reads |

### Environment variables relevant to observability

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Enable OTLP trace export to a collector |
| `TRACING_ENABLED` | unset | Enable tracing with console exporter (debug) |
| `OTEL_SERVICE_NAME` | `readwise` | Service name on spans |
| `ERROR_REPORTING_PROVIDER` | `log` | Error sink selector |
| `ERROR_ALERT_THRESHOLD` | `10` | Per-fingerprint alert threshold |
| `APP_VERSION` | package version | Release tag on errors and spans |

### Cross-references

- **Observability architecture:** [`docs/observability/overview.md`](../observability/overview.md)
- **Metrics registry and recorders:** [`docs/observability/metrics.md`](../observability/metrics.md)
- **Client-error reporting:** [`docs/observability/client-error-reporting.md`](../observability/client-error-reporting.md)
- **Job queue and admin operations:** [`docs/operations/admin-operations.md`](./admin-operations.md)
- **TTS job operations:** [`docs/operations/tts-jobs.md`](./tts-jobs.md)
- **Health and readiness:** [`docs/platform/health-readiness.md`](../platform/health-readiness.md)
- **Push notifications:** [`docs/platform/push-notifications.md`](../platform/push-notifications.md)
- **Database runbooks:** [`docs/platform/database-runbooks.md`](../platform/database-runbooks.md)
- **SLI/SLO implementation:** `src/lib/observability/slo-catalog.ts`
- **Metrics recorders:** `src/lib/metrics/recorders/`
