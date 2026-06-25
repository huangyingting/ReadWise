# Admin operations, jobs and audit logs

This document covers the operational systems used by the ReadWise admin area:
the persistent job queue, article-processing step state, durable audit logs,
content-source health, and the admin routes that expose them.

## Admin surface map

| Surface | Route / API | Capability / guard | Purpose |
| --- | --- | --- | --- |
| Admin dashboard | `/admin`, `GET /api/admin/stats` | `admin.access` | System overview counts. |
| Articles | `/admin/articles`, `/admin/articles/[id]`, `/api/admin/articles/**` | `articles.manage`, `content.moderate` for review/takedown | Search, inspect, delete, rebuild AI, review, takedown, ingest. |
| Sources | `/admin/sources`, `/api/admin/sources/**` | `sources.manage` | Sync provider registry, toggle providers, inspect health/counters. |
| Tags | `/admin/tags`, `/api/admin/tags/**` | `tags.manage` | Rename/merge/delete global tags. |
| Members | `/admin/members`, `/admin/members/[id]`, `/api/admin/members/**` | `members.manage`, `support.assist` for support actions | Manage roles, support tooling, session revocation, export/repair helpers. |
| Jobs | `/admin/jobs`, `/api/admin/jobs/**` | `jobs.manage` | Queue dashboard, retry/cancel/archive, enqueue backfills. |
| Analytics | `/admin/analytics`, `/admin/analytics/ai`, `/api/admin/analytics/**`, `/api/admin/ai/usage` | `analytics.view` | Product analytics, AI ledger, processing health, exports. |
| Security | `/admin/security`, `/api/admin/security/events`, `/api/admin/audit-logs` | `security.view` / admin handler | Security events and durable audit log reads. |
| Metrics/SLO | `/api/admin/metrics`, `/api/admin/slo` | admin/capability-gated | Prometheus-style metrics and SLO evaluation. |

Admin pages are rendered inside `src/app/admin/layout.tsx`, which requires admin
access and shows `AdminNav`. Section pages and APIs still perform their own
capability/admin checks for defense in depth.

## Persistent job queue

The `Job` table is the durable queue for background work. It survives restarts
and supports multiple workers safely.

### Model fields

| Field | Meaning |
| --- | --- |
| `type` | One of `ARTICLE_INGEST`, `ARTICLE_PROCESS`, `AI_REBUILD`, `TTS_GENERATE`, `PUSH_REMINDER`. |
| `status` | `PENDING`, `CLAIMED`, `RUNNING`, `COMPLETED`, `FAILED`, `DEAD_LETTER`. |
| `payload` | JSON metadata such as `articleId`, `provider`, `url`, `tts`, `translateLangs`, or `userId`. |
| `attempts`, `maxAttempts` | Retry accounting. |
| `priority`, `runAfter` | Scheduling controls; higher priority runs first among ready jobs. |
| `lockedBy`, `lockedAt` | Worker lock owner and lease timestamp. |
| `lastError`, `errorHistory` | Bounded error history for operators. |
| `dedupeKey` | Optional idempotency key; active duplicate work returns the existing row. |
| `startedAt`, `completedAt`, `failedAt`, `deadLetteredAt` | Lifecycle timestamps. |

### Claiming and locking

`claimNextJob(workerId, opts)` is atomic:

- PostgreSQL uses `FOR UPDATE SKIP LOCKED` to prevent two workers from claiming
  the same row.
- SQLite/dev/test uses a serialized transaction with a guarded update.
- `PENDING` and `FAILED` jobs are claimable when `runAfter <= now`.
- `CLAIMED`/`RUNNING` jobs are reclaimable when `lockedAt` is older than the
  lock TTL (`DEFAULT_LOCK_TTL_MS = 10 minutes` unless overridden).

The worker can refresh a long-running lock with `heartbeatJob(...)`.

### Retry policy

Default policy is 5 attempts, 1 second base backoff, 5 minute max backoff.
Per-type overrides live in `RETRY_POLICIES`:

| Job type | Max attempts | Base backoff | Max backoff |
| --- | ---: | ---: | ---: |
| `ARTICLE_INGEST` | 5 | 2s | 5m |
| `ARTICLE_PROCESS` | 5 | 2s | 5m |
| `AI_REBUILD` | 4 | 5s | 10m |
| `TTS_GENERATE` | 3 | 5s | 10m |
| `PUSH_REMINDER` | 3 | 1s | 1m |

Backoff is exponential with jitter:

$$
delay = min(max, base \times 2^{attempt-1}) + jitter
$$

where jitter is bounded by `min(base, exp)`.

### Failure classification

`JobError` can mark a failure as permanent. Validation, missing-entity, and
permission failures are permanent by default. Provider/unknown failures are
retryable unless attempts are exhausted. Permanent or exhausted jobs move to
`DEAD_LETTER`.

### CLI usage

```bash
npm run worker
npm run worker -- --once
npm run worker -- --lock-ttl 600000
```

`npm run worker` uses the persistent queue by default. The older article-state
polling path has been removed; enqueue article work with `npm run process -- --enqueue`
or the admin backfill controls, then drain it with `npm run worker`.

### Admin actions

`runJobAction(jobId, action)` enforces safe transitions:

| Action | Allowed statuses | Effect |
| --- | --- | --- |
| `retry` | `FAILED`, `DEAD_LETTER` | Re-queue as `PENDING`, clear attempts/error/lock state. |
| `cancel` | non-terminal statuses | Move to `DEAD_LETTER` with `cancelled by admin`. |
| `archive` | `COMPLETED`, `DEAD_LETTER` | Hard-delete the job row. |

The jobs page also surfaces counts by status/type, stuck jobs, recent failures,
and dead-letter rows.

## Article-processing step state

`ArticleProcessingStep` records one row per `(articleId, step)` so admins can see
why an article is not fully enriched.

### Step keys

Canonical steps:

```text
difficulty, tags, vocabulary, quiz, translation, speech, grammar
```

Language-specific translations use `translation:<lang>`, for example
`translation:es`.

### Statuses

```text
pending, running, generated, skipped, fallback, failed
```

- `beginStep(articleId, step)` marks the row `running`, increments attempts, and
  clears previous completion/error metadata.
- `finishStep(articleId, step, status, opts)` records terminal outcome,
  model/prompt metadata, and a short error message for failed steps.
- Writes are best-effort and metadata-only. Prompt text and article content are
  never stored in step rows.
- `resetProcessingSteps(articleId, steps?)` clears step state during rebuilds so
  fresh lazy regeneration can repopulate it.

## Durable audit logs

`AuditLog` is an append-only security/admin history table. Actor and target ids
are stored as immutable strings, not foreign keys, so deleting users/articles
never erases the investigation trail.

### Fields

| Field | Meaning |
| --- | --- |
| `action` | Stable action name such as `admin.article.delete`. |
| `actorId`, `actorRole` | User id/role when available. |
| `targetType`, `targetId` | Low-cardinality target descriptor. |
| `metadata` | Sanitized JSON string; secrets/PII are redacted and size-limited. |
| `requestId` | Ambient request id for log/trace correlation. |
| `ipAddress`, `userAgent` | Trusted-proxy-aware request identity metadata. |
| `createdAt` | Event timestamp. |

### Action taxonomy

`AUDIT_ACTIONS` in `src/lib/security/audit.ts` is the source of truth. Current groups:

- Articles: `admin.article.delete`, `admin.article.rebuild_ai`,
  `admin.article.ingest`, `admin.article.review`, `admin.article.takedown`.
- Members/support: `admin.member.role_update`, `admin.member.delete`,
  `admin.member.revoke_sessions`, `admin.member.export`, `admin.member.repair`,
  `admin.member.resend_help`.
- Tags: `admin.tag.rename`, `admin.tag.delete`, `admin.tag.merge`.
- Sources/scraping: `admin.source.toggle`, `admin.source.sync`,
  `admin.scrape.trigger`.
- Jobs: `admin.job.retry`, `admin.job.cancel`, `admin.job.archive`,
  `admin.job.backfill`.
- Account/self-service: `article.import`, `account.export`, `account.delete`.
- Security: `security.admin_access_denied`, `admin.audit_logs.read`.

`recordAuditFromRequest(...)` should be used for request-driven actions. It
attaches session actor fields, trusted client IP, user agent, and request id.
`tryRecordAuditLog(...)` is reserved for best-effort denied-access paths where an
audit persistence failure must not change the auth response.

`GET /api/admin/audit-logs` lists audit rows with `page`, `pageSize`, `action`,
`actorId`, and `targetType` filters. Reading audit logs is itself audited as
`admin.audit_logs.read`.

## Content-source operations

Provider extraction logic remains in code (`src/lib/scraper/providers/`). The
`ContentSource` table stores operator-controlled state and crawl health.

### Registry sync

`syncContentSources()` upserts one row per provider. Existing rows keep operator
settings and counters; only `displayName` and `baseUrl` are refreshed. New rows
start `enabled = true` and `healthStatus = unknown`.

### Scraper gate

`isProviderEnabled(providerKey)` returns the persisted `enabled` value when a row
exists. Unsynced providers default to enabled so scraping works before the first
sync.

### Health counters

`recordCrawlRun(providerKey, outcome)` folds one run into cumulative counters:

| Counter | Meaning |
| --- | --- |
| `lastDiscoveryCount` | Number of URLs discovered in the latest run. |
| `totalDiscovered`, `totalScraped`, `totalFailed`, `totalDuplicates`, `totalRejected` | Lifetime counters. |
| `consecutiveFailures` | Runs with an explicit error or discovered > 0 but saved 0. |
| `consecutiveZeroDiscovery` | Runs that discovered 0 URLs. |
| `lastError`, `lastCrawledAt` | Latest error and crawl time. |

Health derives from counters:

| Status | Rule |
| --- | --- |
| `healthy` | No recent error/failure/zero-discovery streak. |
| `degraded` | At least one recent failure, zero-discovery run, or last error. |
| `failing` | `consecutiveFailures >= 3` or `consecutiveZeroDiscovery >= 3`. |
| `unknown` | Pre-first-crawl default. |

Each recorded crawl also emits ingestion metrics.

## Article moderation and takedown

Article moderation is documented in [`content-policy.md`](../content/content-policy.md).
Operationally:

- Review/takedown actions write `ContentReview` history rows.
- Takedown states other than `active` force the article to `DRAFT`.
- Restoring to `active` does not auto-publish; an editor must explicitly review
  and publish.
- Publishing is blocked while `takedownState !== "active"`.

## Operator checklist

When an article or provider looks unhealthy:

1. Check `/admin/jobs` for stuck, failed, or dead-letter jobs.
2. Check the article detail page for `ArticleProcessingStep` statuses.
3. Check `/admin/sources` for provider health/counter drift.
4. Use audit logs to find recent admin actions against the article/provider/job.
5. Use request ids from audit/security/error logs to correlate with structured
  logs and traces (see [`observability.md`](../observability/observability.md)).

When performing destructive actions:

- Prefer inline admin UI confirmations.
- Ensure the route records an audit action.
- Ensure successful admin mutations produce a security event through the shared
  API handler.
- Do not archive active/running jobs; only terminal jobs are safe to archive.
