---
type: "runbook"
status: "current"
last_updated: "2026-07-01"
description: "Documents subsystem capacity assumptions, limits, observable signals, and scaling levers. Captures current throughput constraints, provider bottlenecks, cache/queue/storage limits, Redis adoption gate, and follow-up gaps."
---

# Capacity planning baselines

This document records the known limits, observable signals, baseline assumptions,
and scaling levers for each major ReadWise subsystem. Every estimate is labeled
with its assumption and a verification command. Unknowns are flagged as
follow-ups rather than invented.

Cross-references: [incident-response.md](./incident-response.md) ·
[admin-operations.md](./admin-operations.md) ·
[docs/observability/metrics.md](../observability/metrics.md) ·
[docs/observability/overview.md](../observability/overview.md)

---

## Table of contents

1. [AI calls and budgets](#1-ai-calls-and-budgets)
2. [Job queue and worker throughput](#2-job-queue-and-worker-throughput)
3. [Storage and media](#3-storage-and-media)
4. [Scraper volume](#4-scraper-volume)
5. [Push fan-out](#5-push-fan-out)
6. [Database](#6-database)
7. [Listing/feed cache and Redis adoption gate](#7-listingfeed-cache-and-redis-adoption-gate)
8. [Offline cache footprint](#8-offline-cache-footprint)
9. [Missing signals — follow-up items](#9-missing-signals--follow-up-items)

---

## 1. AI calls and budgets

### Known limits (code-enforced)

| Limit | Env var | Default | Scope |
| --- | --- | --- | --- |
| Per-request timeout | `AI_REQUEST_TIMEOUT_MS` | 30 000 ms | Single provider call |
| Max retries per call | `AI_MAX_RETRIES` | 2 | Single provider call |
| Model context window | `AZURE_OPENAI_MAX_CONTEXT_TOKENS` | 128 000 tokens | Chunking/prompt construction |
| Default completion budget | `AI_MAX_OUTPUT_TOKENS` | 4 096 tokens | Per call |
| Per-user daily quota | `AI_QUOTA_USER_DAILY` | unlimited (null) | Interactive path |
| Global interactive daily quota | `AI_QUOTA_GLOBAL_DAILY` | unlimited (null) | Interactive path |
| Global background daily quota | `AI_QUOTA_BACKGROUND_DAILY` | unlimited (null) | Worker/background path |
| Per-feature daily quota | `AI_QUOTA_FEATURE_<NAME>_DAILY` | `AI_QUOTA_FEATURE_DEFAULT_DAILY` | Per feature |
| Quota window | `AI_QUOTA_WINDOW_MS` | 86 400 000 ms (24 h) | All quota counters |

Sources: `src/lib/runtime-config/ai.ts`, `src/lib/ai/budget.ts`.

Quotas are **disabled (unlimited) when their env vars are unset**, so
development and CI run without budget configuration by default. Set limits before
exposing the app to untrusted users.

### Cost rates (configurable)

| Rate | Env var | Default |
| --- | --- | --- |
| Prompt tokens per 1 K | `AI_COST_PROMPT_PER_1K` | $0.00015 |
| Completion tokens per 1 K | `AI_COST_COMPLETION_PER_1K` | $0.0006 |
| Per-model overrides (JSON map) | `AI_COST_RATES` | _(none)_ |

Defaults match GPT-4o-mini pricing at the time of writing; update via
`AI_COST_RATES` for other deployments without code changes.

### Feature labels (quota keys)

Features that trigger AI calls include: `translation`, `quiz`, `vocabulary`,
`grammar`, `tutor`, `tags`, `sentence-translation`. Each maps to a
per-feature quota env var (`AI_QUOTA_FEATURE_TRANSLATION_DAILY`, etc.).
Article difficulty is deterministic and does not consume AI quota.

### Signals to watch

```
GET /api/admin/ai/usage      # ledger summary: count, tokens, cost, fallback rate, cache hits
GET /api/admin/slo           # ai_availability SLI (objective: 0.90, measured via recordAiCall)
GET /api/admin/metrics       # ai_call_total{feature, outcome} counter;
                             # ai_call_duration_ms histogram
```

Key alert conditions (see [incident-response.md](./incident-response.md)):

- `ai_availability` SLI below 0.90 → SEV-2.
- Fallback rate > 20 % for any feature → investigate provider health or budget exhaustion.
- `estimatedCostUsd` growing faster than expected → check for runaway background
  enrichment; adjust `AI_QUOTA_BACKGROUND_DAILY`.
- 429 errors from the interactive path → per-user or global quota hit.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Cost overrun | Set `AI_QUOTA_GLOBAL_DAILY` and `AI_QUOTA_BACKGROUND_DAILY`; tune `AI_COST_RATES` for correct billing model |
| Runaway background enrichment | Reduce `AI_QUOTA_BACKGROUND_DAILY`; cap per-feature with `AI_QUOTA_FEATURE_<NAME>_DAILY` |
| User exhausting budget | Set `AI_QUOTA_USER_DAILY` |
| High latency | Reduce `AI_MAX_RETRIES`; lower `AI_REQUEST_TIMEOUT_MS`; route to a faster deployment |
| Token cost (large articles) | Tune `AZURE_OPENAI_MAX_CONTEXT_TOKENS` and `AI_MAX_OUTPUT_TOKENS`; improve chunking |

### Baseline assumptions

> **Estimate** — not measured in production. Refresh with real ledger data once
> `AI_LEDGER_ENABLED=1` is set and traffic is flowing for ≥ 7 days.

- Interactive feature calls average 500–2 000 prompt tokens + 200–800 completion
  tokens (short vocabulary/translation tasks).
- Tutor sessions are the heaviest per-call: up to 4 000 prompt tokens.
- TTS (Azure Speech) does not go through the OpenAI ledger; see [§ 3](#3-storage-and-media).
- AI rebuild (`AI_REBUILD`) jobs re-enrich a single article across all features;
  estimated 3–8 AI calls per rebuild.

---

## 2. Job queue and worker throughput

### Known limits and defaults

| Parameter | Value | Source |
| --- | --- | --- |
| Poll interval | 5 000 ms (default) | `src/lib/worker/loop.ts:47` |
| Lock TTL (stale-lock detection) | 10 min | `src/lib/jobs/types.ts` — `DEFAULT_LOCK_TTL_MS` |
| Worker concurrency | **1 job at a time per process** (single-claim loop) | `src/lib/worker/loop.ts` |

Workers are single-threaded claim loops. Horizontal scaling is achieved by
running additional worker processes; each claims a separate job under `FOR UPDATE
SKIP LOCKED` (PostgreSQL) or a serialized transaction (SQLite).

### Retry policies (per job type)

| Job type | Max attempts | Base backoff | Max backoff |
| --- | --- | --- | --- |
| `ARTICLE_INGEST` | 5 | 2 s | 5 min |
| `ARTICLE_PROCESS` | 5 | 2 s | 5 min |
| `AI_REBUILD` | 4 | 5 s | 10 min |
| `TTS_GENERATE` | 3 | 5 s | 10 min |
| `PUSH_REMINDER` | 3 | 1 s | 60 s |

Source: `src/lib/jobs/retry-policy.ts`.

A job that exhausts all attempts moves to `DEAD_LETTER` status. Dead-letter
recovery requires manual admin intervention (re-enqueue or delete via
[admin-operations.md](./admin-operations.md)).

### Signals to watch

```
GET /api/admin/jobs/stats          # pending / claimed / running / failed / dead-letter counts
GET /api/admin/metrics             # worker_job_total{outcome} counter;
                                   # worker_job_duration_ms histogram;
                                   # job_queue_event_total{event,type} counter;
                                   # job_lock_age_ms histogram (stale-lock detection)
GET /api/admin/slo                 # worker_processing_latency SLI
```

Alert conditions:

- Dead-letter count > 0 → investigate failed job payloads.
- `job_lock_age_ms` > 10 min → worker crashed with a lock held; will auto-recover
  after TTL.
- Pending queue depth > 500 → consider adding worker processes.
- `worker_processing_latency` SLI breaching → jobs taking longer than expected.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Queue backlog growing | Add worker processes (each is an independent single-job loop) |
| Stale locks accumulating | Workers auto-reclaim after `lockTtlMs`; reduce TTL for faster recovery |
| Specific job type slow | Investigate handler; add type filter to a dedicated worker process |
| Dead-letter pile-up | Use admin bulk-requeue; fix root cause first |

### Baseline assumptions

> **Estimate** — refresh from `worker_job_duration_ms` once real traffic flows.

- `ARTICLE_INGEST` + `ARTICLE_PROCESS` combined: ~5–30 s per article (scrape +
  AI enrichment).
- `TTS_GENERATE`: ~10–60 s per article (Azure Speech API latency + storage write).
- `PUSH_REMINDER`: < 1 s per user batch.
- A single worker process can drain ~2–10 articles per minute depending on AI
  and TTS latency.

---

## 3. Storage and media

### Backends and selection

| `MEDIA_STORAGE` value | Backend | Notes |
| --- | --- | --- |
| unset / `local` | Local filesystem (`MEDIA_STORAGE_DIR`, default `./.media`) | Default; suitable for development/single-node |
| `filesystem` | Local filesystem | Legacy alias for `local` |
| `azure` | Azure Blob Storage | Recommended for multi-node or large audio libraries |

Source: `src/lib/storage/`, `src/lib/storage/config.ts`.

Objects are content-addressed (SHA-256 keyed): `speech/<sha256><ext>`. Identical
audio never duplicates on disk/blob.

### Known limits

| Limit | Value | Source |
| --- | --- | --- |
| Audio cache header | `private, max-age=3600` | `src/app/api/reader/[id]/speech/audio/route.ts` |
| Storage key length | Bounded by SHA-256 + hint prefix | `src/lib/storage/key.ts` |
| Scraper body cap | 5 MiB (default) | `src/lib/runtime-config/scraper.ts` |

No hard per-account or per-article storage quota is enforced in code. Object
storage growth is driven by TTS audio output.

### TTS audio growth estimate

> **Estimate** — no production measurements. Refresh by summing `MediaAsset.sizeBytes`
> on a representative dataset.

- Azure Speech produces roughly 1 MB of MP3 per minute of speech.
- Average article reading time: ~5–15 min → ~5–15 MB per article.
- 1 000 narrated articles ≈ **5–15 GB** of audio storage.
- Content-addressing means re-narrating the same text produces identical bytes;
  storage growth is bounded by unique text volume.

### Signals to watch

```
GET /api/ready                # checks.providers.storage (degraded = credentials missing)
GET /api/admin/metrics        # No storage-specific counters today (follow-up § 9)
```

Alert conditions:

- `checks.providers.storage = "degraded"` → Azure credentials missing while
  `MEDIA_STORAGE=azure`; new speech audio is not cached until storage is healthy.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Local disk growth from audio | Move to Azure Blob Storage or implement an audio retention/expiry policy |
| Azure egress costs | Enable CDN in front of the audio endpoint; tune `max-age` |
| Storage growing without bound | Implement audio retention/expiry policy (follow-up § 9) |

---

## 4. Scraper volume

### Known limits

| Limit | Env var | Default | Notes |
| --- | --- | --- | --- |
| Response body cap | `SCRAPER_MAX_BYTES` | 5 242 880 (5 MiB) | Hard abort at this size |
| Request timeout | `SCRAPER_TIMEOUT_MS` | 15 000 ms | Connect + redirect + body read |
| Robots cache | — | 1 000 entries (LRU) | `src/lib/scraper/robots.ts` |
| HTML normalizer | `SCRAPER_HTML_NORMALIZE` | `false` | Optional post-processing pass |

Sources: `src/lib/runtime-config/scraper.ts`, `src/lib/scraper/robots.ts`.

SSRF protections (`src/lib/scraper/ssrf.ts`) block private/loopback ranges
regardless of the above limits.

### Provider coverage

12 structured providers are registered (`src/lib/scraper/providers/`):
BBC, BBC Learning English, HuffPost, Knowable, NatGeo, Nautilus, NBC, Noema,
Smithsonian, Technology Review, Time, Undark. Unknown
providers fall back to generic HTML extraction.

### Signals to watch

```
GET /api/admin/metrics    # content_ingestion_run_total{outcome} counter;
                          # content_processing_step_total{step, outcome} counter
```

Alert conditions:

- `content_ingestion_run_total{outcome="error"}` rising → provider blocked or
  network issue.
- Repeated `timeout` outcomes → increase `SCRAPER_TIMEOUT_MS` or investigate
  slow providers.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Slow providers causing queue backlog | Increase `SCRAPER_TIMEOUT_MS`; add provider-specific fast path |
| Body cap rejecting large pages | Increase `SCRAPER_MAX_BYTES` (max recommended: 20 MiB) |
| High outbound bandwidth | Throttle `ARTICLE_INGEST` worker concurrency |

### Baseline assumptions

> **Estimate** — no volume measurements in production yet.

- Each article scrape: 1 HTTP request (+ redirects), < 5 MiB body, 1–15 s.
- A single worker process can scrape ~4–60 articles per minute depending on
  provider latency.
- Robots.txt cache (1 000 LRU entries) is adequate for deployments with < 1 000
  distinct source domains.

---

## 5. Push fan-out

### Known limits

| Limit | Value | Source |
| --- | --- | --- |
| Sends per reminder run | 1 notification per eligible subscriber | `src/lib/push/scheduler.ts` |
| Subscriptions per user | Unlimited (one per browser endpoint) | Schema: `PushSubscription` |
| Consecutive failure threshold | 8 failures → subscription pruned | `src/lib/push/subscription-health.ts` — `MAX_CONSECUTIVE_FAILURES` |
| Delivery parallelism | All subscriptions sent in parallel (`Promise.all`) | `src/lib/push/delivery.ts` |

### Reminder scheduling

`sendDueReminders()` is designed for **hourly** or **daily** invocation. It
finds all users with ≥ 1 due SRS card who have an active push subscription, then
sends one notification per user. Preference gates: `disabled` flag, `preferredHour`,
quiet hours, timezone.

### Signals to watch

```
GET /api/admin/metrics        # No dedicated push counter today (follow-up § 9)
scripts/push-reminders.ts     # Returns { usersWithDue, sent, skipped, suppressed }
GET /api/ready                # checks.providers.push: configured | unconfigured
```

Alert conditions:

- `sent` << `usersWithDue` → many subscriptions pruned or preferences suppressing.
- `PUSH_REMINDER` dead-letter accumulating → delivery is failing consistently.
- `isPushConfigured()` false → VAPID env vars missing; no reminders are sent.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Reminder delivery failing at scale | Add push-specific metrics (follow-up § 9); move from `Promise.all` to batched parallel sends |
| Dead subscriptions accumulating | Threshold (`MAX_CONSECUTIVE_FAILURES`) auto-prunes; monitor for stale rows |
| Push volume spike | Stagger reminder dispatch windows; add rate limiting per provider |

### Baseline assumptions

> **Estimate** — no production fan-out measurements.

- Web Push payload is tiny (< 1 KB JSON title + body + URL).
- `Promise.all` fan-out is acceptable for < 10 000 subscriptions per run; above
  that, batching should be introduced (follow-up § 9).
- Each web-push provider (FCM, APNs, etc.) enforces its own rate limits; these
  are currently unmonitored.

---

## 6. Database

### Supported engines

| Engine | Use case | Connection pattern |
| --- | --- | --- |
| **SQLite** (`file:` URL) | Local development, single-node | Single process; no pool |
| **PostgreSQL** (`postgresql://` URL) | Staging / production | Prisma connection pool |

Source: `src/lib/db-utils.ts`, `src/lib/prisma.ts`, `prisma/postgresql/schema.prisma`.

### Connection pooling

Prisma manages a connection pool. No explicit `connection_limit` or
`pool_size` is set in the Prisma schema (using Prisma defaults). Prisma's
default connection pool size is `num_cpus * 2 + 1` for PostgreSQL.

For serverless or edge deployments, configure PgBouncer and append
`?pgbouncer=true&connection_limit=1` to `DATABASE_URL` to avoid connection
exhaustion.

### Job-claim strategy by engine

| Engine | Claim mechanism | Notes |
| --- | --- | --- |
| PostgreSQL | `FOR UPDATE SKIP LOCKED` | True lock-free concurrent multi-worker claim |
| SQLite | Serialized transaction with guarded conditional update | Concurrent workers compete on a single write lock |

Source: `src/lib/jobs/claim-postgres.ts`, `src/lib/jobs/claim-generic.ts`.

### Indexes of note

- PostgreSQL: `Article_search_vector_idx` — GIN expression index over
  title/excerpt/content for full-text search.
- PostgreSQL: indexes on `Job(status, type, runAfter)` for efficient worker
  claims.

See [docs/platform/database.md](../platform/database.md) and
[docs/platform/database-runbooks.md](../platform/database-runbooks.md) for
migration and operational runbooks.

### Signals to watch

```
GET /api/admin/slo     # All SLIs are ultimately backed by DB queries
GET /api/admin/metrics # api_request_duration_ms and worker_job_duration_ms
                       # histograms include DB time as part of total latency
```

Alert conditions:

- Reader or worker SLI latency rising without AI/TTS explanation → suspect slow
  DB queries or lock contention.
- `job_lock_age_ms` > 10 min → stale lock; worker crashed. Locks reclaim
  automatically after `DEFAULT_LOCK_TTL_MS` (10 min).
- SQLite in a multi-process deployment → switch to PostgreSQL; SQLite serialize
  writes and will bottleneck worker concurrency.

### Scaling levers

| Problem | Lever |
| --- | --- |
| Connection pool exhaustion | Set `connection_limit` in `DATABASE_URL`; add PgBouncer |
| Slow FTS queries | Verify `Article_search_vector_idx` is present and used (`EXPLAIN ANALYZE`) |
| High write latency (SQLite) | Migrate to PostgreSQL |
| Large `AiInvocation` table | Add retention policy; delete rows older than rolling window |

### Baseline assumptions

> **Estimate** — no production query timing data yet.

- Prisma default pool: `num_cpus * 2 + 1` connections (e.g. 5 on a 2-CPU node).
- Worker poll cycle (claim attempt): ~5–20 ms on PostgreSQL with index scan.
- Article search with FTS: ~20–200 ms depending on corpus size and query
  complexity.
- `AiInvocation` row volume: grows linearly with AI calls; ~1 row per call.
  At 1 000 calls/day, retention past 90 days = ~90 000 rows (negligible).

---

## 7. Listing/feed cache and Redis adoption gate

### Current decision

Do **not** introduce Redis for article listing or recommendation reads until a
measured bottleneck crosses the gates below. ReadWise already has several cache
layers and cache-like read models:

- Next.js Data Cache wrappers in `src/lib/cache.ts` for public, user-scoped,
  and tenant-scoped listings.
- Listing cache key/tag policy in `src/lib/listing-cache.ts`.
- Cache metrics via `recordCacheLookup` / `recordCacheMiss`.
- DB-backed AI, speech, translation, grammar, and sentence-level caches.
- Bounded in-process TTL cache primitive for non-listing network TTLs.

Redis is therefore treated as a future optional acceleration layer, not the
default response to larger data volume.

### Candidate paths to benchmark first

The first capacity benchmark should focus on article discovery and
recommendation reads because they combine article volume, tag volume, learner
state, candidate caps, and in-memory ranking:

| User path | API / page entry | Core function |
| --- | --- | --- |
| For You feed | `GET /api/feed` and dashboard feed load | `getPersonalizedFeed` |
| Browse picks | `GET /api/articles?view=picks` and `/browse?view=picks` | `listScoredPicksPage` |
| Browse category/all | `GET /api/articles?category=...` and `/browse` | `listCategoryPage` |

Benchmark the core functions first to isolate database access, ranking, and
cache behavior from HTTP/auth/browser noise. Add HTTP-level load testing only
after function-level measurements are understood.

### Benchmark data policy

Use synthetic, repeatable benchmark data instead of scraper/AI/TTS seed data.
The benchmark should generate only the columns needed by these read paths:
articles, public tags, article-tag edges, users, profiles, and reading progress.

The benchmark must run only on disposable benchmark databases. A future script
should refuse to run unless all of the following are true:

- `READWISE_BENCHMARK_DB=1` is set.
- The SQLite file path or PostgreSQL database name contains `benchmark` or
  `perf`.
- The script prints the resolved database target before seeding or measuring.
- Production, staging, and ordinary development databases are rejected by
  default.

Run both supported engines, but make PostgreSQL authoritative for production
capacity and Redis decisions.

| Engine | Use in benchmark | Decision weight |
| --- | --- | --- |
| SQLite | Local regression and developer-experience trend | Informational only |
| PostgreSQL | Production-like capacity, query plans, pool/concurrency behavior | Authoritative |

If SQLite and PostgreSQL disagree, use PostgreSQL as the source of truth.

### Suggested first benchmark scale

> **Benchmark target** — not yet measured. Choose the smallest scale that is
> plausibly 10× the next 6–12 months of expected corpus/user growth.

Initial synthetic scale:

- 50 000–100 000 public articles.
- 200 000–500 000 `ArticleTag` rows.
- 10 000–50 000 users.
- Tens to hundreds of `ReadingProgress` rows per active benchmark user.
- Profiles distributed across CEFR levels and topic sets.

The benchmark should report p50, p95, p99, min/max, sample count, database
engine, dataset scale, cache mode, and the tested function/path.

### Cache modes to measure

Measure at least two groups for every path:

| Mode | Configuration | Purpose |
| --- | --- | --- |
| Cold listing cache | `READWISE_DISABLE_LISTING_CACHE=1` | Measure DB + ranking cost without listing cache help |
| Hot listing cache | default cache behavior | Measure repeated-read behavior and existing cache effectiveness |

When practical, add an invalidation recovery group: mutate profile/article/tag
state, trigger the existing invalidator, then measure how quickly the path
returns to the hot-cache profile.

Interpretation guide:

- Cold slow, hot fast → existing cache works; Redis is not automatically needed.
- Cold and hot slow → investigate queries, pagination, candidate caps, and
  ranking/precomputation before Redis.
- Cold fast, hot slow → cache layer problem; Redis is not the first fix.
- Hot cache effective locally but production remains slow due to multi-instance
  non-shared cache behavior → Redis/shared external cache becomes a reasonable
  design candidate.

### Redis entry criteria

Enter Redis design only when all of these are true:

1. PostgreSQL benchmark or production-like traffic shows `GET /api/feed`,
   `GET /api/articles`, dashboard feed load, or browse feed load with sustained
   p95 latency above **800 ms** at the target scale.
2. Function-level measurements show the listing/recommendation read path is a
   meaningful contributor, not just HTTP/auth/rendering overhead. As a rule of
   thumb, a core function p95 above **300 ms** deserves DB/query investigation;
   if API p95 is high while functions are fast, inspect the surrounding stack
   first.
3. PostgreSQL query plans have been reviewed with `EXPLAIN ANALYZE` or an
   equivalent slow-query workflow.
4. Lower-complexity fixes have been considered in this order:
   1. Query plan and index fixes.
   2. Pagination changes, especially replacing deep offset pagination with
      cursor/keyset pagination where applicable.
   3. Candidate-set narrowing or better DB-side filtering.
   4. Precomputed read models or recommendation snapshots.
   5. Redis/shared external cache.
5. The target result has high reuse potential and safe invalidation semantics.
6. Existing cache hit/miss metrics show that a shared external cache would
   improve real traffic rather than merely add infrastructure.

### Redis design constraints if the gate is crossed

Redis must be optional, low-risk, and privacy-preserving:

- Store only disposable, rebuildable cache entries. PostgreSQL remains the
  source of truth.
- Do not cache article bodies, selected text, prompts, AI responses, raw
  translations, credentials, cookies, tokens, secrets, or other user-private
  content.
- Prefer lightweight read models: article id lists, cursor/page metadata,
  bounded display metadata, version stamps, and invalidation markers.
- Every key must include explicit visibility scope: `public`, `user:{id}`, or
  `org:{id}`. User/org scoped entries must never share a key with public data.
- Define invalidation before implementation: writer, reader, TTL, invalidators,
  maximum allowed staleness, and fallback behavior.
- TTL is a safety net, not the only invalidation mechanism.
- Redis outages, timeouts, serialization failures, or invalidation failures must
  degrade to the DB/existing cache path. Requests may become slower, but core
  reading/listing flows must not fail because Redis is unavailable.
- Use short Redis timeouts (tens of milliseconds, not request-scale timeouts).
- Gate Redis with an environment flag so it can be disabled without a code
  deploy.
- Roll out lowest-risk public listing keys before personalized/user feed keys.

### Required Redis observability before rollout

No Redis-backed cache should ship without low-cardinality metrics for:

- cache name and outcome (`hit`, `miss`, `write_error`, `read_error`,
  `timeout`, `fallback`);
- Redis read/write latency buckets;
- DB fallback count;
- invalidation count and invalidation failure count;
- key count / memory trend from Redis operational telemetry;
- paired API p95/p99 and database slow-query trend for the affected paths.

Redis is successful only if it reduces the relevant API p95/p99 and/or database
pressure without increasing error rate, privacy risk, or operational fragility.

---

## 8. Offline cache footprint

### Service-worker cache

| Constant | Value | Source |
| --- | --- | --- |
| Offline article expiry | 30 days | `src/lib/pwa/constants.ts` — `OFFLINE_ARTICLE_EXPIRY_MS` |
| Cache name versioning | `SW_CACHE_NAME` (prefix + version) | `src/lib/cache-version.ts` |
| Stale SW caches | Purged on `activate` | `public/sw.js` |

Pre-cached assets include: shell HTML pages (`OFFLINE_PAGE`,
`OFFLINE_READER_PAGE`), static JS/CSS chunks, and fonts. Dynamic content is
cached per-article in IndexedDB.

### IndexedDB stores

| Store | Purpose | Expiry |
| --- | --- | --- |
| `articles` | Offline article HTML + metadata | 30 days (`EXPIRY_MS`) |
| `mutations` | Offline mutation queue | Drained on sync; max 5 retries (`MAX_MUTATION_RETRIES`) |

Sources: `src/lib/offline/idb.ts`, `src/lib/offline-sync.ts`.

### Baseline per-article footprint

> **Estimate** — measure with DevTools Application → Storage → IndexedDB.

- Article HTML body: ~50–500 KB per article (compressed in transit).
- 10 offline articles ≈ 0.5–5 MB IndexedDB.
- The offline reader is designed for personal use; there is no server-side quota
  for offline storage.

### Scaling levers

- Reduce expiry via `OFFLINE_ARTICLE_EXPIRY_MS` constant (requires code change
  and SW/HTML drift test update).
- Limit the number of downloadable articles per user at the API layer
  (follow-up § 9).

---

## 9. Missing signals — follow-up items

The following signals are needed for production-grade capacity planning but are
not yet implemented or measured. These should be addressed before ReadWise scales
beyond a single-tenant pilot.

| # | Area | Gap | Suggested signal |
| --- | --- | --- | --- |
| F-1 | Storage | No metric for total blob storage bytes or per-article audio size | Add `storage_bytes_written_total` counter in `put()` |
| F-2 | Push | No metric for push delivery success/failure rate | Add `push_send_total{outcome}` counter in `sendToSubs()` |
| F-3 | Push | Third-party provider rate limits not monitored | Parse 429 responses from web-push library; record as `push_rate_limited_total` |
| F-4 | Push | No cap on subscriptions per user | Add DB-level check or soft limit in subscribe route |
| F-5 | Scraper | No per-provider latency histogram | Add `scraper_fetch_duration_ms{provider}` histogram |
| F-6 | Database | No pool exhaustion signal | Configure Prisma `log: ["warn"]` and alert on `query_wait_timeout` |
| F-7 | Database | `AiInvocation` table has no retention policy | Add a nightly cleanup job or cron to delete rows older than N days |
| F-8 | AI | Token-per-feature averages not measured over time | Export `ai_prompt_tokens_total` and `ai_completion_tokens_total` counters per feature |
| F-9 | Jobs | No queue-depth metric (pending job count) | Add `job_queue_depth{type,status}` gauge to the worker poll cycle |
| F-10 | Offline | No server-side limit on articles downloadable per user | Consider a per-user cap enforced at `GET /api/reader/[id]/offline` |
| F-11 | Listing/feed capacity | No repeatable synthetic benchmark for feed/listing paths | Add a benchmark script guarded by `READWISE_BENCHMARK_DB=1`, measuring `getPersonalizedFeed`, `listScoredPicksPage`, and `listCategoryPage` on SQLite and PostgreSQL |

---

## How to refresh these baselines

1. **Enable the AI ledger**: set `AI_LEDGER_ENABLED=1` in production. Query
   `GET /api/admin/ai/usage` after 7 days to obtain real token and cost
   averages per feature.
2. **Query job latency**: read `worker_job_duration_ms` histogram buckets from
   `GET /api/admin/metrics` after the queue has processed ≥ 100 jobs of each
   type.
3. **Measure audio storage**: capture the `sizeBytes` sum from `MediaAsset` rows.
4. **Measure listing/feed capacity**: run the synthetic benchmark described in
    [§ 7](#7-listingfeed-cache-and-redis-adoption-gate) against disposable SQLite
    and PostgreSQL benchmark databases; treat PostgreSQL as authoritative.
5. **Measure DB query time**: enable slow-query logging in PostgreSQL
   (`log_min_duration_statement = 500ms`) and review `pg_stat_statements`.
6. **Push delivery**: add the F-2 counter and observe `sent`/`failed` rates
   over one week of scheduled reminders.

Update this document with real measurements in the same PR that adds each signal.
Label all values with whether they are **measured** or **estimated**.
