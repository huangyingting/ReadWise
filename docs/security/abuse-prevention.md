# Abuse Prevention: Signals, Thresholds, and Mitigation Hooks

> **Status:** Design (Phase 1). Items marked **✅ implemented** are enforced
> today. Items marked **🔲 proposed** are design targets for follow-on issues.
>
> **Parent:** Epic #734 · **Issue:** #737
>
> Related: [`docs/security/overview.md`](./overview.md),
> [`docs/security/data-lifecycle-matrix.md`](./data-lifecycle-matrix.md)

---

## Purpose

ReadWise has solid point-of-call controls — fixed-window rate limits, AI
budget quotas, SSRF guards, per-user daily import caps, and a security-event
ring buffer. What is missing is a *product-level abuse-signal layer*: a
documented set of signals, thresholds, and mitigation hooks that distinguish
normal learning behaviour from cost abuse, scraping abuse, or platform
misuse at each expensive or public-ish flow.

This document fills that gap. For each abuse-prone flow it records:

1. **Abuse vectors** — what an adversary or misbehaving client can do.
2. **Signals** — observable quantities (rate, volume, cost, failure rate, repetition).
3. **Thresholds** — suggested trip points (tunable via env / admin config).
4. **Mitigation hooks** — existing controls + proposed extensions.

---

## Security primitives already in place

Before describing per-flow signals, the table below maps the existing
infrastructure components referenced throughout this document.

| Primitive | Source | Notes |
|---|---|---|
| Fixed-window rate limiter | `src/lib/security/rate-limit/index.ts` | Scopes: `ai`, `import`, `lookup`, `public`, `admin-job`, `auth`. DB-backed with in-memory fallback + circuit breaker. |
| AI budget / quota | `src/lib/ai/budget.ts` | Per-user, per-feature, global-interactive, global-background counters. Interactive throws 429; background degrades gracefully. Env: `AI_QUOTA_*`. |
| Import daily quota | `src/lib/import/quota.ts` | 5 articles / user / UTC-day. Checked after de-dup, before DB write. |
| SSRF guard | `src/lib/scraper/ssrf.ts` | Validates + pins DNS for all outbound fetches; blocks private/metadata IPs; closes DNS-rebinding gap via undici dispatcher. |
| Robots.txt | `src/lib/scraper/robots.ts` | Fail-open crawl-policy check with 1 h TTL cache, max 1000 origins. |
| Scraper limits | `src/lib/runtime-config/scraper.ts` | `SCRAPER_MAX_BYTES` (default 5 MiB), `SCRAPER_TIMEOUT_MS` (default 15 s), `MAX_REDIRECTS = 5`. |
| TTS char cap | `src/lib/speech/index.ts` | `MAX_TTS_CHARS = 5000` per article synthesis. |
| Security events | `src/lib/security/events.ts` | Ring-buffered, structured, spike-detected. Types: `auth.unauthorized`, `rate_limit.exceeded`, `import.failed`, `import.blocked`, `lookup.suspicious_volume`, `admin.mutation`, `csrf.blocked`. |
| Client IP | `src/lib/security/client-ip.ts` | Trusted-proxy-aware; spoofable without `TRUSTED_PROXY_*` config (see `overview.md`). |
| Audit log | `src/lib/security/audit.ts` | Durable DB log for admin/security history. |

---

## Flow 1 — URL import (`POST /api/reader/import/url`)

### Abuse vectors

- **SSRF probe**: submitting `http://169.254.169.254/...` or internal URLs to
  reach cloud metadata or internal services.
- **Quota exhaustion**: automated scripts cycling through users or disposable
  accounts to import unlimited content.
- **Scraper amplification**: using ReadWise as a free scraping proxy for
  high-volume crawls of third-party sites.
- **Rate flooding**: bursting the import endpoint to trigger expensive scrapes
  and incur egress cost.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Import rate per user | Fixed-window counter | `checkRateLimit(userId, "import")` ✅ |
| Daily import count | UTC-day article count per user | `assertWithinDailyQuota()` ✅ |
| SSRF rejections per IP | Security event `import.blocked` | `recordSecurityEvent` ✅ |
| Scrape failure rate per user | Security event `import.failed` | `recordSecurityEvent` ✅ |
| Distinct domains imported per user/day | 🔲 New counter: unique `hostname` per UTC window | Proposed |
| Re-import repetition | 🔲 Count import attempts for already-owned URLs | Proposed |

### Thresholds (defaults)

| Threshold | Default | Env override |
|---|---|---|
| Import rate (per minute per user) | 10 requests / min | `RATE_LIMIT_IMPORT_REQUESTS` |
| Daily import cap | 5 articles / day | `DAILY_IMPORT_LIMIT` (code constant) |
| Scrape failure spike (same user, rolling window) | 🔲 ≥ 5 failures / 10 min → alert | `SECURITY_EVENT_ALERT_THRESHOLD` |
| Distinct domains / day | 🔲 ≥ 20 domains / day → soft flag | Proposed env |

### Mitigation hooks

- **✅ SSRF guard** blocks private/metadata URLs before any network call and
  emits `import.blocked` (severity: `medium`) via `recordSecurityEvent`.
- **✅ Rate limiter** (`import` scope, DB-backed) throws 429 on burst.
- **✅ Daily quota** throws 429 after 5 new articles per UTC day.
- **✅ De-dup** on raw URL before scraping avoids consuming quota or network on
  re-import of an existing article.
- **🔲 Domain-diversity cap**: reject (or queue for manual review) if a single
  user imports from > N distinct domains in a day — signals proxy/scraping use.
- **🔲 Admin alert**: when SSRF rejections from a single IP exceed the spike
  threshold, escalate `import.blocked` to `high` severity so the alert seam
  fires (currently `medium`).

---

## Flow 2 — Text/paste import (`POST /api/reader/import/text`)

### Abuse vectors

- **Storage abuse**: pasting enormous documents (up to `MAX_TEXT_BYTES = 200 000`
  bytes) to exhaust DB storage.
- **Content violation**: importing copyrighted or prohibited text at scale.
- **Quota bypass**: exploiting the text path if quota enforcement were absent.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Import rate per user | Fixed-window counter | `checkRateLimit(userId, "import")` ✅ |
| Daily import count | UTC-day article count | `assertWithinDailyQuota()` ✅ |
| Payload size distribution | Log `text.length` at import | 🔲 Add structured log field |
| Minimum word-count rejection rate | Counter for `MIN_IMPORT_WORDS` rejections | 🔲 Existing validation; add metric |

### Thresholds

| Threshold | Default | Env / constant |
|---|---|---|
| Import rate | 10 / min | `RATE_LIMIT_IMPORT_REQUESTS` |
| Daily cap | 5 / day | `DAILY_IMPORT_LIMIT` |
| Max payload | 200 000 bytes | `MAX_TEXT_BYTES` (code constant) |
| Min words | 50 words | `MIN_IMPORT_WORDS` (code constant) |

### Mitigation hooks

- **✅ Rate limit** (`import` scope) and **✅ daily quota** — same as URL import.
- **✅ Input validation**: `MAX_TEXT_BYTES` and `MIN_IMPORT_WORDS` rejected at
  the handler level before any DB write.
- **🔲 Payload size metric**: emit a structured log/metric field (`textBytes`)
  so unusual submission sizes are visible in observability dashboards.

---

## Flow 3 — AI feature calls (tutor / translation / quiz / vocabulary)

### Abuse vectors

- **Per-user over-consumption**: a user repeatedly calling expensive AI features
  (translation, quiz generation) to exhaust per-user or global budget.
- **Feature-level DoS**: targeting a single AI feature until its daily cap is
  hit, denying service to all users of that feature.
- **Background worker runaway**: a bug in the enrichment processor triggering
  unlimited background AI calls.
- **Cost amplification**: submitting very long articles to maximize token usage
  per call.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Per-user AI calls / window | Fixed-window counter (`user:$userId`) | `assertAiQuota / checkAiBudget` ✅ |
| Per-feature AI calls / window | Fixed-window counter (`feature:$feature`) | `assertAiQuota / checkAiBudget` ✅ |
| Global interactive AI calls / window | Fixed-window counter (`global:interactive`) | `assertAiQuota` ✅ |
| Global background AI calls / window | Fixed-window counter (`global:background`) | `checkAiBudget` ✅ |
| Estimated cost / window (USD) | AI invocation ledger aggregate | `getAiBudgetStatus()` ✅ |
| Budget-blocked call rate | Log `ai_budget.blocked` events | `assertAiQuota` ✅ |
| Token usage per call | Ledger `promptTokens` / `completionTokens` | AI invocation ledger ✅ |
| Repeated identical prompts | 🔲 Hash prompt inputs; count repeats per user | Proposed |

### Thresholds

| Threshold | Default | Env |
|---|---|---|
| Per-user daily interactive cap | Unlimited (disabled) | `AI_QUOTA_USER_DAILY` |
| Global interactive daily cap | Unlimited (disabled) | `AI_QUOTA_GLOBAL_DAILY` |
| Global background daily cap | Unlimited (disabled) | `AI_QUOTA_BACKGROUND_DAILY` |
| Per-feature daily cap | Unlimited (disabled) | `AI_QUOTA_FEATURE_<NAME>_DAILY` |
| AI rate limit (requests / min) | 20 / min per user | `RATE_LIMIT_AI_REQUESTS` |
| Quota window | 24 h | `AI_QUOTA_WINDOW_MS` |

> **Deployment note**: quotas are *disabled* when the env knobs are unset.
> Production deployments should configure at least `AI_QUOTA_USER_DAILY` and
> `AI_QUOTA_GLOBAL_DAILY` as a cost floor.

### Mitigation hooks

- **✅ `assertAiQuota`** — throws `ApiError(429)` on per-user, per-feature, or
  global-interactive quota breach; integrated in `chatCompleteWithMeta` for all
  interactive AI calls.
- **✅ `checkAiBudget`** — non-throwing background check; returns `allowed:
  false` and caller skips the AI call gracefully.
- **✅ `getAiBudgetStatus`** — admin snapshot of usage vs limits; exposed via
  `GET /api/admin/ai/usage`.
- **✅ Rate limiter** (`ai` scope, 20 req/min per user).
- **🔲 Cost-spike alert**: when `estimatedCostUsd` in the current window
  exceeds a configurable threshold (`AI_COST_ALERT_USD`), emit a security event
  with severity `high` so the alert seam fires.
- **🔲 Prompt-repetition counter**: hash prompt inputs (no raw text stored);
  if the same user submits the same prompt hash > N times, log a security event
  and optionally apply a short backoff.

---

## Flow 4 — TTS / speech generation (`POST /api/reader/:id/speech`)

### Abuse vectors

- **Per-article synthesis cost**: each synthesis call invokes Azure Speech for
  up to 5 000 characters; repeated calls for the same article waste provider
  quota (though the result is cached).
- **Cache bypass**: requesting synthesis for articles the user does not own, or
  forcing re-synthesis by invalidating cache entries.
- **Token endpoint abuse** (`GET /api/speech/token`): repeatedly fetching
  ephemeral Azure tokens to use outside the app.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| TTS synthesis rate per user | Fixed-window counter | `checkRateLimit(userId, "lookup")` ✅ (token) |
| Azure token fetch rate | Fixed-window counter | `checkRateLimit(userId, "lookup")` ✅ |
| Cache-miss synthesis calls / window | 🔲 Count `cached: false` results per user | Proposed structured log |
| TTS characters synthesized / user / day | 🔲 Accumulate `plainText.length` in ledger | Proposed |

### Thresholds

| Threshold | Default | Env / constant |
|---|---|---|
| TTS char cap per synthesis | 5 000 chars | `MAX_TTS_CHARS` (code constant) |
| Token fetch rate | 60 / min per user | `RATE_LIMIT_LOOKUP_REQUESTS` |
| TTS synthesis rate | 🔲 Suggest dedicated `tts` scope: 5 / min | Proposed |
| Daily chars synthesized | 🔲 Suggest 50 000 chars / user / day | Proposed |

### Mitigation hooks

- **✅ `MAX_TTS_CHARS = 5000`** caps per-synthesis cost.
- **✅ DB cache** (`articleSpeech` table): synthesis skipped on cache hit;
  result returned immediately with no Azure call.
- **✅ Article ownership check** (`requireReadableArticleForAI`): synthesis
  denied for articles the user cannot read.
- **✅ `checkRateLimit(userId, "lookup")`** on the token endpoint (60 req/min).
- **🔲 Dedicated `tts` rate-limit scope**: apply a narrower limit (e.g. 5 / min)
  to `POST /api/reader/:id/speech` to prevent cache-miss storms.
- **🔲 Daily TTS character budget**: accumulate characters synthesized per user
  per UTC day; reject further synthesis with 429 when the cap is reached.

---

## Flow 5 — Admin scrape trigger (`POST /api/admin/scrape/trigger`)

### Abuse vectors

- **Bulk egress amplification**: triggering scrape of all providers (`all: true`)
  at high `limit` values generates many outbound HTTP requests.
- **Credential misuse**: an admin whose account is compromised can scrape
  arbitrary providers or inject malicious URLs via a custom provider.
- **Provider flooding**: repeatedly triggering the same provider overwhelms the
  target site or causes IP-level blocks.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Scrape trigger frequency per admin | Fixed-window counter | `checkRateLimit(userId, "admin-job")` ✅ |
| Scrape failures per provider per window | Security event `import.failed` | `recordSecurityEvent` ✅ |
| Audit log trail | Every trigger logged | `AUDIT_ACTIONS.adminScrapeTrigger` ✅ |
| Total articles saved per trigger | Log `scrape.trigger.provider_done` | ✅ |
| Admin-initiated trigger count / hour | 🔲 Count `admin.mutation` events per actor | Proposed |

### Thresholds

| Threshold | Default | Env |
|---|---|---|
| Admin job rate | 30 / min | `RATE_LIMIT_ADMIN_JOB_REQUESTS` |
| Max articles per provider per trigger | 50 (hard) / 5 (default) | `MAX_LIMIT` / `DEFAULT_LIMIT` constants |
| Provider failure spike | 🔲 ≥ 3 consecutive failures → alert | Proposed |

### Mitigation hooks

- **✅ `createAdminHandler`** — requires valid admin session; 401/403 on
  unauthorized access.
- **✅ `checkRateLimit(userId, "admin-job")`** — 30 req/min per admin.
- **✅ `limit` cap**: `MAX_LIMIT = 50` hard-coded; requests above this are
  rejected at the validation layer.
- **✅ Audit log** (`adminScrapeTrigger`) on every call including provider list
  and limit.
- **✅ `recordSecurityEvent(importFailed, medium)`** on per-provider discover/save
  failures.
- **🔲 Provider-level failure threshold**: after N consecutive failures for the
  same provider within a window, emit `importFailed` at severity `high` so the
  alert seam fires.
- **🔲 Frequency alert**: if the same admin triggers scrape more than X times
  per hour, escalate `admin.mutation` to `high` severity.

---

## Flow 6 — Admin backfill / rebuild (`POST /api/admin/jobs/backfill`)

### Abuse vectors

- **Runaway rebuild**: `mode: "rebuild"` with no `batchCap` and broad filters
  can enqueue hundreds or thousands of AI enrichment jobs, exhausting AI budget
  and DB write throughput.
- **Targeted article repair as data exfiltration**: using `articleIds` arrays to
  probe content enrichment paths.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Backfill trigger frequency per admin | `checkRateLimit(userId, "admin-job")` ✅ | Rate limiter |
| Articles processed per backfill run | Audit log `adminJobBackfill` metadata | `recordAuditFromRequest` ✅ |
| AI budget consumed by backfill | `global:background` counter | `checkAiBudget` ✅ |
| Rebuild (vs missing-only) ratio | 🔲 Log `mode` field frequency | Proposed |

### Thresholds

| Threshold | Default | Env / constant |
|---|---|---|
| Admin job rate | 30 / min | `RATE_LIMIT_ADMIN_JOB_REQUESTS` |
| Batch cap | 500 max (validated) | `batchCap` param max |
| Background AI daily cap | Unlimited (disabled) | `AI_QUOTA_BACKGROUND_DAILY` |

### Mitigation hooks

- **✅ `createAdminHandler`** — admin session required.
- **✅ `batchCap` validation**: max 500 articles per backfill invocation.
- **✅ `checkAiBudget`** — background AI calls are skipped non-throwingly when
  `AI_QUOTA_BACKGROUND_DAILY` is reached.
- **✅ Audit log** (`adminJobBackfill`) on every run with `mode`, `features`,
  `reason`, and article count.
- **🔲 Mandatory `reason` field for rebuild mode**: already required by
  validation schema; confirm observability tooling surfaces it in dashboards.
- **🔲 Rebuild-mode alert**: emit an `admin.mutation` security event at severity
  `medium` whenever `mode: "rebuild"` is triggered, regardless of rate.

---

## Flow 7 — Push subscription churn (`POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`)

### Abuse vectors

- **Subscription flooding**: automating rapid subscribe/unsubscribe cycles to
  inflate subscription table size or generate push-delivery errors.
- **Endpoint harvesting**: probing which push endpoints are reachable.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Subscribe/unsubscribe rate per user | Fixed-window counter | `checkRateLimit(userId, "lookup")` ✅ |
| Active subscription count per user | 🔲 Count rows in `PushSubscription` per user | Proposed |
| Churn rate (subscribe then unsubscribe) | 🔲 Delta of subscription events per user/day | Proposed |

### Thresholds

| Threshold | Default | Env |
|---|---|---|
| Push subscription rate | 60 / min per user | `RATE_LIMIT_LOOKUP_REQUESTS` |
| Max active subscriptions / user | 🔲 Suggest: 5 | Proposed |
| Churn threshold | 🔲 ≥ 10 subscribe+unsubscribe cycles / hour → flag | Proposed |

### Mitigation hooks

- **✅ `checkRateLimit(userId, "lookup")`** on subscribe/unsubscribe.
- **✅ Upsert by endpoint** — re-subscribing from the same endpoint is
  idempotent and does not create duplicate rows.
- **🔲 Per-user subscription cap**: query active subscription count before
  inserting a new one; return 429 if exceeded.

---

## Flow 8 — Client-error reporting (`POST /api/client-errors`)

### Abuse vectors

- **Log poisoning**: submitting crafted error payloads with PII, tokens, or
  XSS strings to contaminate server logs.
- **DoS via error flooding**: overwhelming the log sink with high-volume error
  reports from an automated client.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Error report rate per IP | Fixed-window counter | `checkRateLimitByKey(ipKey, "public")` ✅ |
| Scrubbing events (email / token redaction hits) | 🔲 Count `scrubClientText` replacements per call | Proposed |

### Thresholds

| Threshold | Default | Env |
|---|---|---|
| Client error report rate (per IP) | 30 / min | `RATE_LIMIT_PUBLIC_REQUESTS` |
| Max message length | 2 000 chars | Validation schema |
| Max stack length | 8 000 chars | Validation schema |

### Mitigation hooks

- **✅ IP-based rate limit** (`public` scope, 30 / min) — silent 204 on
  excess (no rate-limit signal leaked to client).
- **✅ `scrubClientText`**: strips email addresses and long token-like strings
  before logging.
- **✅ `stripUrlSensitive`**: removes query string and hash from reported URLs.
- **✅ Always 204**: client never learns whether the event was accepted or
  rate-limited.

---

## Flow 9 — Authentication pressure (`POST /api/auth/...`)

### Abuse vectors

- **Credential stuffing**: repeated login attempts across many accounts.
- **Brute force**: high-volume guesses against a single account.
- **Token/session replay**: reusing leaked session tokens.

### Signals

| Signal | How to measure | Source |
|---|---|---|
| Auth attempt rate per IP | Fixed-window counter | `checkRateLimitByKey(ipKey, "auth")` ✅ |
| Auth attempt rate per user | Fixed-window counter | `checkRateLimit(userId, "auth")` ✅ |
| Repeated 401 events | Security event `auth.unauthorized` | `recordSecurityEvent` ✅ |
| Failed-login spike (same IP) | Spike detector in `recordSecurityEvent` | ✅ |

### Thresholds

| Threshold | Default | Env |
|---|---|---|
| Auth request rate | 10 / min per user or IP | `RATE_LIMIT_AUTH_REQUESTS` |
| Spike alert threshold | Configurable | `SECURITY_EVENT_ALERT_THRESHOLD` |

### Mitigation hooks

- **✅ `checkRateLimit(userId, "auth")`** — 10 req/min.
- **✅ `recordSecurityEvent(unauthorized / forbidden, medium/high)`** on failed
  auth flows.
- **✅ Spike detection** in `events.ts` — escalates through `captureError` when
  count crosses the threshold within the rolling window.
- **🔲 Progressive backoff**: after N consecutive 401s from the same IP, apply
  an increasing delay before the 429 response (not a block, reduces brute-force
  throughput without hard-locking accounts).

---

## Cross-cutting guidance

### Redaction policy

All signal metadata MUST be produced using the existing redaction primitives:

- `scrubContext` (from `src/lib/observability/errors.ts`) for error aggregation.
- `scrubClientText` for client-reported strings.
- `src/lib/security/redaction.ts` for audit-log metadata.

Signals MUST NOT record: article text, selected text, AI prompts, AI
completions, session tokens, cookies, passwords, or any content the user
considers private. Only safe operational fields are permitted: user IDs, hashed
IPs, feature names, counts, timestamps, error codes.

### Multi-instance limitation

The in-memory spike counters in `events.ts` are **per-process**. In a
multi-instance deployment a coordinated attack spread across N instances may
not trip the threshold on any single node. Cross-instance counts are written
to the shared DB store (best-effort, fire-and-forget) for future cluster-level
aggregation, but the immediate alert gate remains per-instance. See the
`INSTANCE-LOCAL LIMITATION` note in `src/lib/security/events.ts` and the
tracking issue #622.

### Adding new security event types

When a proposed signal emits a new event type, add it to the `SECURITY_EVENT_TYPES`
map in `src/lib/security/events.ts` alongside the existing entries. This
ensures low-cardinality keys, consistent filtering in the admin UI, and metric
labels.

### Phased adoption

| Phase | Scope |
|---|---|
| **P1 (done)** | Rate limits, AI budgets, import quota, SSRF guard, security events, audit logs |
| **P2 (this issue — design)** | Document signals, thresholds, and mitigation hooks per flow (this document) |
| **P3 (proposed)** | Implement highest-value proposed signals: TTS rate scope, push subscription cap, domain-diversity counter for imports, cost-spike alert for AI |
| **P4 (future)** | Cluster-level spike aggregation (#622), progressive auth backoff, prompt-repetition counter |

---

## Reference — env configuration summary

| Env var | Scope | Default |
|---|---|---|
| `RATE_LIMIT_AI_REQUESTS` | AI interactive rate | 20 / min |
| `RATE_LIMIT_IMPORT_REQUESTS` | Import rate | 10 / min |
| `RATE_LIMIT_LOOKUP_REQUESTS` | Lookup / TTS token / push | 60 / min |
| `RATE_LIMIT_PUBLIC_REQUESTS` | Public / client-errors | 30 / min |
| `RATE_LIMIT_ADMIN_JOB_REQUESTS` | Admin scrape / backfill | 30 / min |
| `RATE_LIMIT_AUTH_REQUESTS` | Auth endpoints | 10 / min |
| `RATE_LIMIT_WINDOW_MS` | All rate-limit windows | 60 000 ms |
| `RATE_LIMIT_STORE` | `auto` \| `database` \| `memory` | `auto` |
| `AI_QUOTA_USER_DAILY` | Per-user AI calls / 24 h | unlimited |
| `AI_QUOTA_GLOBAL_DAILY` | Global interactive AI calls / 24 h | unlimited |
| `AI_QUOTA_BACKGROUND_DAILY` | Global background AI calls / 24 h | unlimited |
| `AI_QUOTA_FEATURE_<NAME>_DAILY` | Per-feature AI calls / 24 h | unlimited |
| `AI_QUOTA_WINDOW_MS` | AI quota window | 86 400 000 ms (24 h) |
| `SCRAPER_MAX_BYTES` | Outbound body cap | 5 242 880 (5 MiB) |
| `SCRAPER_TIMEOUT_MS` | Outbound request timeout | 15 000 ms |
| `SECURITY_EVENT_ALERT_THRESHOLD` | Spike → alert count | (runtime-config default) |
| `SECURITY_EVENT_WINDOW_MS` | Spike rolling window | (runtime-config default) |
| `SECURITY_EVENT_BUFFER_SIZE` | Ring-buffer capacity | (runtime-config default) |
| `TRUSTED_PROXY_HEADER` | Trusted IP header | (none — soft/spoofable) |
| `TRUSTED_PROXY_LIST` | Trusted proxy CIDRs | (none) |
| `TRUSTED_PROXY_HOPS` | Trusted proxy hop count | (none) |
