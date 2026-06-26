# Admin operations, jobs and audit logs

This document covers the **Operations / Background Processing** subsystem as
defined in ADR-0010. It describes how work is scheduled, retried, repaired,
observed, and operated — from the persistent job queue through the worker
lifecycle, processing-step timeline, backfill/rebuild/repair workflows, and
operator checklists.

**Domain-ownership reminder (ADR-0010):** Operations owns scheduling, recovery,
and observability. It does **not** own the enrichment work itself — AI, Article
Library, Media/Speech, and Learning own those semantics. The worker is a
durable execution harness that calls into those domains; it does not duplicate
their logic.

> **`scripts/` are CLI adapters, not business-rule owners.** Every script in
> `scripts/` parses CLI arguments, validates provider availability, and calls
> into a library module. Business rules (retry policy, step orchestration,
> backfill planning, push scheduling) live in `src/lib/`. Scripts add no
> logic beyond argument parsing and progress formatting. See
> [§ Scripts are CLI adapters](#scripts-are-cli-adapters) below.

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

### Status vocabulary

Job statuses form two groups — active and terminal:

| Status | Group | Meaning |
| --- | --- | --- |
| `PENDING` | active | Ready to run; `runAfter <= now` for it to be claimable. |
| `CLAIMED` | active | Reserved by a worker; lock timestamp held. |
| `RUNNING` | active | Handler executing; lock refreshed by heartbeat. |
| `FAILED` | active | Handler threw; will be retried when `runAfter` elapses. |
| `COMPLETED` | terminal | Work finished successfully; may be archived. |
| `DEAD_LETTER` | terminal | Permanently failed (exhausted retries or permanent error). May be archived. |

Active statuses (`PENDING`, `CLAIMED`, `RUNNING`, `FAILED`) are counted toward
the per-`dedupeKey` "one active job" invariant. Terminal jobs with the same
`dedupeKey` are re-enqueued when new work arrives.

### Claiming and locking

`claimNextJob(workerId, opts)` is atomic:

- PostgreSQL uses `FOR UPDATE SKIP LOCKED` to prevent two workers from claiming
  the same row.
- SQLite/dev/test uses a serialized transaction with a guarded conditional
  update.
- `PENDING` and `FAILED` jobs are claimable when `runAfter <= now`.
- `CLAIMED`/`RUNNING` jobs are reclaimable when `lockedAt` is older than the
  lock TTL (`DEFAULT_LOCK_TTL_MS = 10 minutes` unless overridden). This recovers
  locks held by crashed workers without manual intervention.

Once claimed, the worker calls `startJob(jobId, workerId)` to transition the
row to `RUNNING` and anchor the lock timestamp. For long-running work the
worker can call `heartbeatJob(jobId, workerId)` to refresh `lockedAt` and
prevent stale-lock reclamation.

### Retry policy

Default policy is 5 attempts, 1 second base backoff, 5 minute max backoff.
Per-type overrides live in `RETRY_POLICIES` (`src/lib/jobs/retry-policy.ts`):

| Job type | Max attempts | Base backoff | Max backoff |
| --- | ---: | ---: | ---: |
| `ARTICLE_INGEST` | 5 | 2s | 5m |
| `ARTICLE_PROCESS` | 5 | 2s | 5m |
| `AI_REBUILD` | 4 | 5s | 10m |
| `TTS_GENERATE` | 3 | 5s | 10m |
| `PUSH_REMINDER` | 3 | 1s | 1m |

Backoff is exponential with jitter:

```
delay = min(maxBackoff, baseBackoff × 2^(attempt−1)) + jitter
```

where jitter is bounded by `min(base, exp)`. After each failure `runAfter` is
set to `now + delay`, so the job stays in `FAILED` status and becomes
reclaimable only after the backoff window.

### Failure classification

`JobError` (`src/lib/jobs/errors.ts`) carries a `kind` and an optional
`permanent` flag. The `classifyJobError` helper maps arbitrary thrown errors to
a `ClassifiedError`:

| Error kind | Default behaviour |
| --- | --- |
| `validation` | Permanent — dead-letter immediately, no retry. |
| `missing` | Permanent — dead-letter immediately (e.g. article not found). |
| `permission` | Permanent — dead-letter immediately. |
| `provider` | Transient — retry until attempts exhausted. |
| `unknown` | Transient — retry until attempts exhausted. |

A handler can override the default by throwing `new JobError(msg, { permanent: true })`.
When a failure is permanent **or** `attempts >= maxAttempts`, `failJob` writes
`DEAD_LETTER` and emits a `dead_letter` metric. Otherwise it writes `FAILED`,
sets `runAfter`, and emits a `retry` metric.

Up to 25 error-history entries are retained in `errorHistory` (JSONB) for
operator inspection. Older entries are dropped automatically.

### Admin actions

`runJobAction(jobId, action)` (`src/lib/jobs/admin-commands.ts`) enforces safe
transitions:

| Action | Allowed statuses | Effect |
| --- | --- | --- |
| `retry` | `FAILED`, `DEAD_LETTER` | Re-queue as `PENDING`, reset attempts/error/lock/timestamps. |
| `cancel` | non-terminal (`PENDING`, `CLAIMED`, `RUNNING`, `FAILED`) | Move to `DEAD_LETTER` with `cancelled by admin`. |
| `archive` | `COMPLETED`, `DEAD_LETTER` | Hard-delete the job row. |

The jobs page also surfaces counts by status/type, stuck jobs, recent failures,
and dead-letter rows.

## Worker lifecycle

`runJobWorker(options)` (`src/lib/worker/index.ts`) is the stable public entry
point. Internally it is split into three modules:

- `loop.ts` — the runtime poll-claim-execute loop (type-agnostic).
- `registry.ts` — maps `JobType` → `JobHandler`; handlers are injectable for
  testing.
- `types.ts` — shared types for the worker surface.

### Startup sequence

1. `runJobWorker` generates a `workerId` (`worker-<pid>-<rand>`) unless one is
   supplied.
2. It creates the default `JobHandlerRegistry`:
   - `ARTICLE_INGEST`, `ARTICLE_PROCESS`, `AI_REBUILD`, `TTS_GENERATE` → all
     use `makeArticleHandler(processArticle)`.
   - `PUSH_REMINDER` → no-op acknowledgement handler (push reminders have their
     own dedicated pipeline; this prevents dead-lettering on unconfigured
     deployments).
3. Optional `options.handlers` overrides are merged after the defaults.
4. `runWorkerLoop` starts.

### Poll-claim-execute loop

```
for (;;) {
  check AbortSignal → stop if aborted
  claimNextJob()  → null: sleep(pollIntervalMs), continue
                  → job: startJob → handler(job) → completeJob
                            ↳ error: failJob → FAILED (retry) or DEAD_LETTER
}
```

- **Idle poll interval** defaults to 5 000 ms. Configurable via `--interval`.
- **Once mode** (`--once`): exits when `claimNextJob` returns `null` (queue
  drained). Useful for test runs and one-shot batch drain.
- **Signals**: `SIGINT`/`SIGTERM` set the `AbortController` signal. The loop
  finishes the current job then exits cleanly. `stoppedBySignal` is set in the
  returned `JobWorkerStats`.

### Worker stats

`runJobWorker` returns `JobWorkerStats`:

| Field | Meaning |
| --- | --- |
| `polls` | Total claim attempts. |
| `claimed` | Jobs claimed. |
| `completed` | Jobs completed successfully. |
| `failed` | Jobs that threw (includes retried and dead-lettered). |
| `retried` | Failed jobs that were scheduled for retry. |
| `deadLettered` | Failed jobs moved to `DEAD_LETTER`. |
| `stoppedBySignal` | Whether the loop stopped due to an abort signal. |

Stats are logged at `info` level when the worker stops.

### Handler contract

A `JobHandler` is:

```ts
(job: Job, ctx: { logger, signal?, process? }) => Promise<void>
```

- Throw to fail the job. Throw `JobError` with `{ permanent: true }` for
  validation/permission/missing-entity errors that must not be retried.
- Check `ctx.signal` for abort requests in long-running handlers.
- `ctx.process` carries `tts` and `translateLangs` from the worker CLI flags —
  these are forwarded to `processArticle` for article jobs.

### CLI usage

```bash
# Drain persistently (default): poll forever
npm run worker

# Drain once and exit (e.g. CI, migration runs)
npm run worker -- --once

# Override stale-lock threshold (ms)
npm run worker -- --lock-ttl 600000

# Include TTS generation and Spanish translations
npm run worker -- --tts --translate es

# Interval between idle polls (ms, default 5000)
npm run worker -- --interval 10000
```

The worker script (`scripts/worker.ts`) is a CLI adapter: it parses arguments
and calls `runJobWorker`. All policy lives in `src/lib/worker/` and
`src/lib/jobs/`.

## Article-processing step state

`ArticleProcessingStep` records one row per `(articleId, step)` so admins can
see exactly why an article is not fully enriched. The processor calls
`beginStep` / `finishStep` for every step it runs; the admin detail page reads
these rows.

### Processing pipeline

`processArticle(articleId, opts)` (`src/lib/processing/processor.ts`) is the
idempotent enrichment orchestrator. It:

1. Loads article state (difficulty, tag/vocab/quiz counts, translations, speech).
2. Iterates `FEATURE_REGISTRY` in order.
3. Skips steps already done (via `isDoneIn` callbacks).
4. Calls `beginStep` → step runner → `finishStep` for each step it runs.
5. Publishes the article when it is still a `DRAFT` and all required steps
   succeeded.

Steps are designed to be cache-first: re-running is a no-op beyond cheap reads.

### Feature registry

`FEATURE_REGISTRY` (`src/lib/processing/registry.ts`) is the single source of
truth for feature keys, labels, step ordering, and missing/clear/done
callbacks. Processing, backfill planning, step-state tracking, and admin ops
all derive their vocabulary from this registry.

Feature keys in processing order:

```text
difficulty → tags → vocabulary → quiz → translation → speech → grammar
```

| Key | Required | Per-lang | Notes |
| --- | --- | --- | --- |
| `difficulty` | yes | no | Cleared by rebuild (nulls `difficultyScore`). |
| `tags` | yes | no | Cleared by rebuild (deletes `ArticleTag` rows). |
| `vocabulary` | yes | no | Cleared by rebuild (deletes `VocabularyItem` rows). |
| `quiz` | yes | no | Cleared by rebuild (deletes `QuizQuestion` rows). |
| `translation` | no | yes | One step key per lang: `translation:<lang>`. |
| `speech` | no | no | Only processed when `ProcessOptions.tts = true`. Step key is `speech`; `StepResult.step` is `tts`. |
| `grammar` | no | no | On-demand per phrase; processor always skips it. Rebuild clears `GrammarExplanation` rows. |

### Step keys

Each feature produces one or more `ArticleProcessingStep` row keys:

```text
difficulty, tags, vocabulary, quiz
translation:es, translation:fr, … (one per language)
speech
grammar
```

### Step statuses

```text
pending → running → generated | skipped | fallback | failed
```

| Status | Meaning |
| --- | --- |
| `pending` | Step has never run for this article. |
| `running` | Step is currently executing (set by `beginStep`). |
| `generated` | Step completed successfully and produced content. |
| `skipped` | Step was bypassed (content already exists, feature not enabled, etc.). |
| `fallback` | Step ran but used a fallback path (e.g. heuristic difficulty instead of AI). |
| `failed` | Step threw an error; `lastError` has a short message. |

Key implementation constraints:
- Writes are **best-effort** — a step-state write failure never breaks the
  actual enrichment. Failures are logged as warnings (mirrors the audit/AI-ledger
  pattern).
- **Metadata only** — step key, status, attempt count, timestamps, model name,
  prompt version, and a short clamped error message (≤ 500 chars). Prompt text
  and article content are never stored in step rows.
- `beginStep` upserts: it resets `completedAt`/`lastError` so the row always
  reflects the current run, not a previous one.
- `finishStep` upserts: a `skipped` step that never went through `beginStep` is
  still persisted.

### Step reset

`resetProcessingSteps(articleId, steps?)` hard-deletes step rows so the
processor can treat the article as fresh on the next run. Rebuild workflows call
this with the affected step keys inside the same transaction that clears the
derived caches (see [§ Backfill, rebuild and repair](#backfill-rebuild-and-repair)).

## Backfill, rebuild and repair

As AI prompts, models, and schemas evolve, derived content needs regeneration.
The operations subsystem provides three controlled modes:

| Mode | Trigger | What it does |
| --- | --- | --- |
| **Backfill (missing)** | Admin UI / `npm run process -- --enqueue` | Enqueues work only for features an article is actually missing. Does not clear existing content. |
| **Rebuild** | Admin UI article-level action | Clears derived caches first, then enqueues regeneration. Produces fresh content regardless of what is present. |
| **Repair** | Admin member support action | Member-level: revokes sessions, exports data, or resets user-owned state. Article-level: re-enqueues stuck/failed jobs. |

### Backfill planning (`runBackfill`)

`runBackfill(opts)` (`src/lib/processing/backfill.ts`) is the
controlled backfill orchestrator:

1. **Scans** candidate articles (bounded by `MAX_BACKFILL_SCAN = 1000`).
2. **Plans** (article, feature) work units by calling `isMissingFrom` callbacks
   from the feature registry.
3. **Deduplicates** against active jobs by their `dedupeKey`
   (`backfill:<feature>:<articleId>`). Already-active work is skipped.
4. **Caps** the plan at `batchCap` (default `DEFAULT_BACKFILL_BATCH_CAP = 50`,
   hard limit `MAX_BACKFILL_BATCH_CAP = 500`). Re-run to continue past the cap.
5. In **rebuild** mode: clears derived caches before enqueuing so the
   cache-first `getOrCreate*` helpers regenerate fresh content.
6. In **dry-run** mode: reports the plan and counts without enqueuing or
   clearing anything.
7. Enqueues `AI_REBUILD` jobs on the persistent queue. The existing
   rate-limited worker drains them at a safe pace.

**Guarantees:**
- **Idempotent**: `dedupeKey` prevents double-enqueuing active work.
- **Safe**: Only derived caches (difficulty, tags, vocab, quiz, translations,
  speech, grammar explanations) are cleared. User-owned study data
  (`SavedWord`, reading progress) is never touched.
- **Auditable**: The rebuild `reason` and operator id are stored in the job
  payload.

### Backfill filters

`BackfillFilter` lets operators scope a run:

```ts
{ status?: string; category?: string; articleIds?: string[] }
```

### Feature-level rebuild (admin UI)

The article detail page exposes a "Rebuild AI" action that calls
`admin.article.rebuild_ai`. Under the hood it clears the relevant derived
caches and enqueues an `AI_REBUILD` job. The audit log records the action.

### Repair (member support)

Member support actions (`support.assist` capability) include:

- `admin.member.revoke_sessions` — revokes all active sessions.
- `admin.member.export` — exports member data.
- `admin.member.repair` — resets user-owned state (e.g. broken reading
  progress or assignment state).
- `admin.member.resend_help` — resends welcome/help content.

### Process CLI

```bash
# Enqueue durable ARTICLE_PROCESS jobs for all unprocessed drafts
npm run process -- --all --enqueue

# Process specific articles inline (bypasses the queue — dev/debug only)
npm run process -- <articleId> [<articleId> ...]

# Dry-run: list unprocessed without doing anything
npm run process -- --all --limit 10

# Include published articles that are missing enrichment steps
npm run process -- --all --include-published --enqueue

# Include TTS and Spanish translations
npm run process -- --all --enqueue --tts --translate es
```

Always prefer `--enqueue` + `npm run worker` for production. Inline processing
bypasses the durable queue and its retry/observability machinery.

## Scripts are CLI adapters

All scripts in `scripts/` follow a single pattern: parse CLI arguments,
validate optional provider availability, then call into `src/lib/`. They own
**no** business rules.

| Script | Library it delegates to |
| --- | --- |
| `scripts/worker.ts` | `src/lib/worker` (`runJobWorker`) |
| `scripts/process.ts` | `src/lib/processing/processor` (`processArticle`, `enqueueArticleProcess`) |
| `scripts/scrape.ts` | `src/lib/scraper` (`scrapeAndSave`, `discoverProviderUrls`) |
| `scripts/push-reminders.ts` | `src/lib/push/scheduler` (`sendDueReminders`) |
| `scripts/seed.ts` | `src/lib/seed` (`runSeed`) |
| `scripts/migrate-storage.ts` | `src/lib/storage` (migration helpers) |
| `scripts/analyze-speech-alignment.ts` | `src/lib/speech` (analysis helpers) |
| `scripts/eval.ts` | `src/lib/ai` (eval runner) |
| `scripts/export-backlog.ts` | `src/lib/article-library` (backlog export) |
| `scripts/check-schema-parity.ts` | schema comparison utilities |
| `scripts/generate-api-catalog.ts` | API catalog generator |
| `scripts/generate-schemas.ts` | JSON schema generator |

Retry policy, step orchestration, backfill planning, push scheduling, and all
business decisions live in `src/lib/`. Scripts exist only to make those
capabilities runnable from the command line.

### Shared CLI harness

Scripts use a shared harness in `scripts/lib/cli.ts`:
`runCli`, `isMain`, `registerShutdownSignals`, `addUniqueFromCsv`, `warnUnknown`.
Shutdown signal registration (`SIGINT`/`SIGTERM`) also lives here so all
long-running scripts stop cleanly on the same signal semantics as the worker.

## Operations dashboard contracts

The admin area surfaces Operations state through several read models. These
describe current behavior; query implementation details may change without
doc updates, but the observable shape described here should remain stable.

### Job queue dashboard (`/admin/jobs`)

`getJobDashboard()` (`src/lib/admin/jobs.ts`) surfaces:

- Job counts broken down by `status` and `type`.
- "Stuck" jobs: `CLAIMED` or `RUNNING` rows whose `lockedAt` is older than
  the lock TTL — these are candidates for operator intervention or automatic
  reclaim on next poll.
- Recent failures: `FAILED` jobs ordered by `failedAt`, with `lastError`.
- Dead-letter rows: `DEAD_LETTER` jobs with full `errorHistory`.

Counts are denominated in the current active snapshot; archived (deleted) jobs
do not appear.

### Content-operations overview (`/admin/analytics/ai`)

`getContentOpsOverview()` (`src/lib/processing/admin-ops.ts`) reads:

- Per-step counts by status (`generated`, `skipped`, `fallback`, `failed`)
  across the `ArticleProcessingStep` table — one row per canonical feature key.
- Articles with failing steps (capped at a small top limit).
- Job-queue backlog from `getJobDashboard`.
- AI cost overview from `getAiCostOverview` (7-day rolling window by default):
  total tokens/cost, average/max latency, breakdown by feature/user/article,
  and high-fallback-rate features.

Step vocabulary is derived from the feature registry (`PROCESSING_STEPS`), so
the dashboard and pipeline always agree on step names without a separate
mapping.

### Metrics and SLO (`/api/admin/metrics`, `/api/admin/slo`)

Operations emits Prometheus-style metrics via `recordJobQueueEvent` and
`recordWorkerJob` (`src/lib/metrics`). Current metric events:

| Metric source | Events |
| --- | --- |
| `recordJobQueueEvent` | `claimed`, `completed`, `retry`, `dead_letter` — each tagged with `type`. |
| `recordWorkerJob` | `outcome` (success/failed/aborted), `attempts`, `durationMs`. |
| `recordContentProcessingRun` | Per-article processing run results. |
| `recordContentProcessingStep` | Per-step outcome within a run. |

SLO evaluation reads the metrics registry. Detailed observability guidance is
in [`docs/observability/overview.md`](../observability/overview.md).

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

## Operator checklists

### Article looks unhealthy or not fully enriched

1. Open the article detail page in `/admin/articles/[id]` and check
   `ArticleProcessingStep` statuses. Look for `failed` or `running` (stuck)
   rows.
2. Open `/admin/jobs` and filter by the article's id in the payload. Check
   for `FAILED` or `DEAD_LETTER` jobs.
3. Click into a dead-letter job and read `errorHistory` — the error kind
   (`validation`, `missing`, `provider`, `unknown`) tells you whether it is a
   data problem or a transient provider issue.
4. If the job failure is transient, use the **Retry** action. The job resets to
   `PENDING` with a fresh attempt counter and becomes reclaimable immediately.
5. If the enrichment content is stale (model/prompt changed), use the **Rebuild
   AI** action from the article detail page. This clears derived caches and
   enqueues a fresh `AI_REBUILD` job.
6. If no job exists at all, enqueue one via the backfill UI or
   `npm run process -- <articleId> --enqueue`.

### Queue has stuck `CLAIMED`/`RUNNING` jobs

1. Check `/admin/jobs` → "Stuck jobs" panel.
2. A stuck job's lock becomes stale after 10 minutes (`DEFAULT_LOCK_TTL_MS`).
   The next `claimNextJob` call automatically recovers it — no manual action
   is needed if the worker is running.
3. If the worker is not running, start it with `npm run worker`. It will
   reclaim stale locks on the first poll.
4. If a specific job appears permanently stuck (rare worker crash leaving the
   lock held), use **Cancel** from the admin UI to move it to `DEAD_LETTER`,
   then **Retry** to re-queue it fresh.

### High dead-letter count for a job type

1. Open `/admin/jobs` → dead-letter view. Group by type to see which job type
   is failing.
2. Inspect `errorHistory` on a sample of dead-letter jobs. Look for the `kind`
   field:
   - `validation` / `missing` / `permission`: data or configuration problem —
     check article existence, payload shape, and capabilities.
   - `provider` / `unknown`: transient provider failure — check AI/Speech
     provider configuration and availability.
3. Fix the root cause.
4. Bulk-retry from the admin UI or, for large volumes, investigate using the
   audit log (`admin.job.retry`) to see prior operator actions.
5. After retrying, monitor `/admin/jobs` and `/admin/analytics/ai` for the
   `failed` step count to fall.

### Backfill — enrich articles missing derived content

1. Navigate to `/admin/jobs` → backfill panel (or use the CLI for headless
   environments).
2. Run a **dry-run** first: `npm run process -- --all --limit 50 --enqueue`
   (omitting `--enqueue` reports what would be processed without doing it).
3. Confirm the candidate set looks correct.
4. Run the backfill: `npm run process -- --all --enqueue`.
5. Start (or verify) the worker is running: `npm run worker`.
6. Monitor `/admin/analytics/ai` for step counts to increase as jobs drain.
7. If articles remain missing after a full drain, check for permanent failures
   in the dead-letter queue.

### Rebuild — force regeneration of derived content

1. For a single article: use the **Rebuild AI** button on the article detail
   page. Confirm the audit action is recorded.
2. For a batch: use the admin backfill UI in rebuild mode with appropriate
   feature and status filters.
3. Rebuild clears derived caches (difficulty, tags, vocab, quiz, translations,
   speech, grammar explanations). User-owned data (saved words, reading
   progress) is **never** affected.
4. After enqueueing, drain the queue with `npm run worker`.

### Repair a member account

Support operators with `support.assist` capability can:

- **Revoke sessions**: immediately signs out all devices.
- **Export data**: generates a GDPR-compliant data export.
- **Repair**: resets broken user-owned state (reading progress, assignment
  state).
- **Resend help**: sends welcome/help content to the member.

All support actions are audited. Find them in the audit log using
`actorId=<support-user-id>` and `targetType=member`.

### Performing destructive actions safely

- Prefer inline admin UI confirmations over direct DB manipulation.
- Ensure the route records an audit action before mutating.
- Ensure successful admin mutations produce a security event through the shared
  API handler.
- Do **not** archive `PENDING`, `CLAIMED`, `RUNNING`, or `FAILED` jobs; only
  `COMPLETED` and `DEAD_LETTER` jobs are safe to archive. The worker may still
  be executing an in-flight job.
- Use request ids from audit/security/error logs to correlate with structured
  logs and traces (see [`overview.md`](../observability/overview.md)).

### Vocabulary / status term quick reference

The following terms appear across the job queue, processing pipeline, and
dashboard. This table unifies them for operator reference:

| Concept | Job queue term | Processing step term | Dashboard label |
| --- | --- | --- | --- |
| Work waiting to run | `PENDING` | `pending` | Pending |
| Work in progress | `CLAIMED` / `RUNNING` | `running` | Active |
| Work succeeded | `COMPLETED` | `generated` | Generated |
| Work bypassed | — | `skipped` | Skipped |
| Work degraded but ok | — | `fallback` | Fallback |
| Work failed, will retry | `FAILED` | `failed` | Failed |
| Work permanently failed | `DEAD_LETTER` | `failed` (no retry) | Dead-letter |

> **Note on duplication:** `failed` is used for both retryable and permanent
> step failures in `ArticleProcessingStep` (permanent jobs also have
> `DEAD_LETTER` on the corresponding `Job` row). Unifying these into a
> `dead_letter` step status is tracked as a future follow-up; do not change
> this mapping without aligned schema, code, and dashboard updates.
