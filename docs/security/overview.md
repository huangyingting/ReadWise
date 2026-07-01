---
title: "Security: trusted proxy/IP, CSRF, security events & audit logs"
category: "Security"
architecture: "Documents security subsystem boundaries for client IP, CSRF, security events, audit logs, redaction, and rate limiting."
design: "Captures current trusted-proxy strategies, same-origin enforcement, event monitoring, redaction policy, and audit-log relationship."
plan: "Update when security config, client-IP logic, CSRF behavior, events, audit logging, redaction, or admin security surfaces change."
updated: "2026-07-01"
rename: "none"
---

# Security: trusted proxy/IP, CSRF, security events & audit logs

This document covers the three hardening pieces shipped in Epic **RW-E005**:

- **RW-027** — trusted proxy & client-IP handling
- **RW-028** — CSRF, session & destructive-action protection
- **RW-029** — security event monitoring & alerting

It also explains how those signals relate to the durable `AuditLog` table used
for admin/security history. Operational job/source/audit workflows are covered
in [`admin-operations.md`](../operations/admin-operations.md), with security
event and audit-log triage in [`security-audit.md`](../operations/security-audit.md).

Everything here is **graceful and opt-in**: with nothing configured the app
behaves exactly as before — but several controls are *weaker* (or spoofable)
until you configure them for your deployment. Each section calls out the
default posture and the residual risk.

---

## Security governance package (REF-037)

The implementation lives under `src/lib/security/` — a cohesive package that
groups all security-sensitive subsystems with narrow public boundaries:

| Submodule | Path | Description |
| --- | --- | --- |
| Client IP | `src/lib/security/client-ip.ts` | Trusted-proxy-aware IP resolution (RW-027) |
| CSRF | `src/lib/security/csrf.ts` | Same-origin enforcement (RW-028) |
| Security events | `src/lib/security/events.ts` | Ring-buffered event monitoring (RW-029) |
| Audit | `src/lib/security/audit.ts` | Durable audit log with metadata redaction |
| Redaction | `src/lib/security/redaction.ts` | Sensitive metadata redaction policy |
| Rate limit | `src/lib/security/rate-limit/index.ts` | Fixed-window limiter with shared store (RW-026) |
| Rate limit store | `src/lib/security/rate-limit/store.ts` | DB-backed counter store with circuit-breaker |

Use the focused modules under `src/lib/security/*` directly. The barrel
`src/lib/security/index.ts` exports the full public surface for code that needs
multiple security helpers.

**Throwing vs best-effort:**

- `checkRateLimitByKey` / `checkRateLimit` / `checkSameOrigin` (when CSRF
  enforcement is on and the check fails) throw `ApiError` and **block** the
  request.
- `recordSecurityEvent`, `recordAuditLog`, `tryRecordAuditLog` are
  **best-effort monitoring side effects** and never throw to the caller.

---

## 1. Trusted proxy & client IP (RW-027)

### Why this matters

Rate limiting, audit logging, and security events are only as trustworthy as
the **client IP** we attribute them to. The `X-Forwarded-For` (XFF) header is a
client-controllable list — a hostile client can prepend fake hops
(`X-Forwarded-For: 1.2.3.4, <real>`). Blindly trusting the *leftmost* entry lets
an attacker forge any IP, evade per-IP rate limits, and poison audit trails.

### How it works

`src/lib/security/client-ip.ts` resolves a **single normalized client IP** from the
request headers according to an explicit trusted-proxy model, instead of
blindly trusting the leftmost XFF hop. It is the single source of client
identity for:

- rate limiting — `clientIpKey(req)` from `src/lib/security/rate-limit`,
- audit logs — `auditRequestInfo` in `src/lib/security/audit.ts`,
- security events — the `ip` field on every `recordSecurityEvent(...)`.

Resolution precedence (first configured strategy wins):

| # | Strategy | Env | Behaviour |
| - | --- | --- | --- |
| 1 | Trusted platform header | `TRUSTED_PROXY_HEADER` | Trust a single edge-guaranteed header (e.g. `cf-connecting-ip`, `true-client-ip`, `x-real-ip`) **directly**. Use this only when your edge sets *and sanitizes* it. |
| 2 | Trusted proxy CIDR list | `TRUSTED_PROXY_LIST` | Walk `X-Forwarded-For` **right → left** and return the first entry that is **not** in the trusted set. |
| 3 | Trusted hop count | `TRUSTED_PROXY_HOPS` | The client is the XFF entry `len - 1 - hops` (counted from the right). `0` ⇒ the rightmost entry (single load balancer). Spoofed extra **left** hops are ignored (clamped at the leftmost entry). |
| 4 | **Unconfigured (default)** | — | **Soft, best-effort:** the leftmost valid XFF entry, else a platform header, else the socket — a **spoofable** identity. |

All addresses are validated/normalized with `node:net`:

- malformed entries are **rejected** (dropped from the XFF chain),
- IPv4 host:port is split (the port stripped); **IPv6 is never truncated**,
- bracketed IPv6 (`[::1]:443`) is unwrapped and lower-cased,
- IPv4-mapped IPv6 (`::ffff:1.2.3.4`) collapses to the bare IPv4.

### Deployment requirements

Pick **one** strategy that matches your platform and set it explicitly:

```bash
# Cloudflare / Fastly etc. — edge sets a guaranteed client-IP header:
TRUSTED_PROXY_HEADER=cf-connecting-ip

# Known proxy/load-balancer IP ranges in front of the app:
TRUSTED_PROXY_LIST=10.0.0.0/8,172.16.0.0/12,2400:cb00::/32

# A fixed number of trusted proxies that append to X-Forwarded-For:
TRUSTED_PROXY_HOPS=1            # one trusted LB; client is the 2nd-from-right hop
```

> **Risk if unset:** with no `TRUSTED_PROXY_*` configured the client IP is
> best-effort and **spoofable**, so per-IP rate limits and IP-scoped security
> events can be evaded. Strong abuse controls **require** correct proxy
> configuration for your platform. Configure exactly **one** strategy that
> matches how your edge populates the forwarding headers — over-trusting
> (e.g. `TRUSTED_PROXY_HEADER` on a platform that does not sanitize it) is as
> dangerous as not configuring at all.

---

## 2. CSRF, session & destructive-action protection (RW-028)

### Posture

The app's authentication uses **NextAuth v4 database sessions** stored in a
`SameSite=Lax`, `HttpOnly` cookie. That already means the browser withholds the
session cookie from most cross-site requests, and NextAuth's own `/api/auth/*`
routes carry a dedicated CSRF token. On top of that we add a cheap,
defense-in-depth **same-origin check** for the app's *own* mutation routes.

### Same-origin enforcement (defense-in-depth)

`src/lib/security/csrf.ts` (`checkSameOrigin`) is enforced **globally** in the shared
mutation path (`createHandler` / `createAdminHandler` /
`createPublicHandler` in `src/lib/api-handler.ts`) for every state-changing
request. The decision is deliberately conservative so legitimate traffic is
never broken:

- **Only** `POST` / `PUT` / `PATCH` / `DELETE` are checked — safe `GET` /
  `HEAD` / `OPTIONS` always pass.
- A request with **no `Origin` header** is treated as **same-origin and
  allowed**. This is the correct, well-justified rule: modern browsers *do*
  send `Origin` on cross-site POSTs (which we block), while server-to-server
  calls, health checks, non-browser `fetch`, many `sendBeacon` calls, and the
  route unit tests send no `Origin`. (A browser that sends
  `Sec-Fetch-Site: cross-site` *without* an `Origin` is still rejected.)
- When `Origin` **is** present it must match the request's own origin (derived
  from the URL and the `Host` / `X-Forwarded-Host` + `X-Forwarded-Proto`
  headers, so it is correct behind a reverse proxy) or a configured allowed
  origin. The literal `"null"` origin is rejected.
- A blocked request returns a clean **403** and emits a `csrf.blocked`
  security event (see §3).

> **Decision — enforce globally, not admin-only.** Because the "missing Origin
> ⇒ allowed" rule keeps every existing same-origin fetch, `sendBeacon`
> client-error report, health check, and route test working, global
> enforcement is safe *and* strictly better than admin-only (it also covers the
> non-admin mutation surface — onboarding, progress, saved words, imports). The
> check is implemented as an early return in `api-handler` (before auth) so the
> emitted event is precisely `csrf.blocked` rather than a generic 403.

Config:

```bash
CSRF_ALLOWED_ORIGINS=https://app.example,https://admin.example  # extra origins
CSRF_ENFORCE=false              # disable (only if a separate CSRF layer fronts the API)
# NEXTAUTH_URL / APP_URL / NEXT_PUBLIC_APP_URL origins are always trusted.
```

### Session cookie settings

`authOptions` (`src/lib/auth.ts`) sets the session cookie explicitly so the
posture is not left to defaults:

- `httpOnly: true` — never readable from JavaScript,
- `sameSite: "lax"` — withheld from cross-site sub-requests (works with the
  OAuth top-level redirect sign-in flow),
- `secure: true` **in production** with the `__Secure-` cookie-name prefix
  (the name matches `middleware.ts`'s `SESSION_COOKIES`),
- `path: "/"`.

Session lifetime stays governed by `session.maxAge` / `updateAge`.

### Destructive admin actions

Destructive admin routes (`DELETE /api/admin/articles/[id]`, member/tag
deletes, rebuild, scrape-trigger, …) already:

- require `CAPABILITIES.adminAccess` (`401` unauth / `403` non-admin),
- are recorded in the `AuditLog` (`src/lib/security/audit.ts`),
- keep their existing inline UI confirmations.

This PR additionally emits an `admin.mutation` security event on every
successful admin mutation and an `auth.admin_denied` event when a non-admin is
turned away (see §3) — without changing the existing authz or audit behaviour.

---

## 3. Security event monitoring & alerting (RW-029)

### The single seam

`src/lib/security/events.ts` exposes one function —
`recordSecurityEvent({ type, severity, route?, status?, actorId?, ip?, meta? })`
— that every security-relevant signal funnels through. It **never throws** (a
failure inside monitoring must not break the request path) and, for each event:

1. emits a structured **`security.event`** log line carrying the ambient
   request id, actor, route, status, and normalized client IP (from §1),
2. increments the `readwise_security_events_total` metric
  (`src/lib/metrics/`, exported via `GET /api/admin/metrics`),
3. appends to a bounded in-memory **ring buffer** (no new DB table —
   provider-agnostic), and
4. for **HIGH/CRITICAL** severity **or** a detected **spike**, escalates
   through the existing `captureError` alert seam
  (`src/lib/observability/errors.ts`) so deployments get alerts with **no new
   alerting code**.

### Event types

| Type | Emitted from | Severity |
| --- | --- | --- |
| `auth.unauthorized` | api-handler 401s | low |
| `auth.forbidden` | api-handler 403s | medium |
| `auth.admin_denied` | admin authz failure | medium |
| `rate_limit.exceeded` | api-handler 429s | medium |
| `csrf.blocked` | same-origin check (§2) | medium |
| `admin.mutation` | successful admin mutation | medium |
| `import.failed` | scraper / import failure | medium |
| `import.blocked` | SSRF-blocked import URL | high |
| `lookup.suspicious_volume` | *reserved* — extensible type, not yet emitted | medium |

Any string is accepted as a `type`, so new emission points can be added without
touching the monitoring core.

### Redaction (critical)

Event `meta` is scrubbed via the **security-owned redaction policy** at
`src/lib/security/redaction.ts` (through `scrubContext` in
`src/lib/observability/errors.ts`), so article text, selected text, prompts,
tokens, cookies, and other secrets can **never** reach a security event:
sensitive keys (`content`, `selected`, `token`, `authorization`, …) are
replaced with `[redacted]`, strings are masked + length-capped, and nested
objects are collapsed. Only safe, low-cardinality fields (method, status,
counts) are kept. See §5 for the full redaction policy reference.

### Spike detection & alerting

A *spike* is the same event type for the same actor/IP crossing
`SECURITY_EVENT_ALERT_THRESHOLD` occurrences within
`SECURITY_EVENT_WINDOW_MS`. Spikes (and any HIGH/CRITICAL event) are routed
through `captureError`, whose alert hook fires the existing alerting path —
plug a real provider in via `setAlertHook` / `setErrorSink` without touching
any call site.

```bash
SECURITY_EVENT_ALERT_THRESHOLD=10     # spike threshold within the window (default 10)
SECURITY_EVENT_WINDOW_MS=60000        # rolling window in ms (default 60s)
SECURITY_EVENT_BUFFER_SIZE=200        # ring-buffer capacity (default 200, max 2000)
```

### Admin endpoint

`GET /api/admin/security/events` (admin-only via `createAdminHandler`) returns
the most recent buffered events, newest first, with optional `?limit=`,
`?type=`, and `?severity=` filters. It is `no-store` (point-in-time) and backed
only by the in-memory ring buffer. The admin UI surfaces it at
`/admin/security`.

### Durable history / SIEM integration

The ring buffer is intentionally ephemeral and provider-agnostic. For durable
history and real alerting, **forward the structured `security.event` log lines
and the `readwise_security_events_total` metric** to your SIEM / log pipeline /
Prometheus, and (optionally) wire `setAlertHook` to your pager. No security
event ever contains article content or secrets, so the logs are safe to ship.

---

## 4. Durable audit logs

Security events answer “what suspicious thing just happened?”; audit logs answer
“who performed this admin/account action, against what target, and from which
request?” They are complementary.

`AuditLog` rows are durable and append-only. Actor and target ids are plain
strings, not foreign keys, so deleting users/articles/tags never erases the
investigation trail.

| Field | Purpose |
| --- | --- |
| `action` | Stable action name, e.g. `admin.article.delete` or `admin.job.retry`. |
| `actorId`, `actorRole` | Session user and role when available. |
| `targetType`, `targetId` | Low-cardinality target descriptor. |
| `metadata` | Sanitized JSON string. Sensitive keys and token/email-like values are redacted. |
| `requestId` | Correlates with structured logs and traces. |
| `ipAddress`, `userAgent` | Trusted-proxy-aware request metadata. |
| `createdAt` | Event timestamp. |

Use `recordAuditFromRequest(...)` for request-driven actions so actor, trusted
client IP, user agent and request id are attached consistently. Use
`tryRecordAuditLog(...)` only for best-effort denied-access paths where an audit
write failure must not change the response.

`GET /api/admin/audit-logs` lists durable rows with filters for `action`,
`actorId`, and `targetType`. Reading audit logs is itself audited as
`admin.audit_logs.read`.

---

## 5. Sensitive metadata redaction policy

**Owner: Security subsystem (`src/lib/security/`).**

The **single redaction policy** lives at `src/lib/security/redaction.ts`. Every
path that persists or logs metadata (audit log, error reporting, analytics
events, security events, AI ledger) **must** use this module as the sole
authority for what constitutes a sensitive key or value. No per-module copy is
permitted.

### Public API

| Function | Purpose |
| --- | --- |
| `isSensitiveMetadataKey(key)` | Returns `true` when a key name likely carries sensitive or user-private content. |
| `redactSensitiveValue(value)` | Inline-masks embedded email addresses as `[email]` and long token-like values as `[token]`. |
| `redactSensitiveObject(obj)` | Flat-object redactor: sensitive keys → `[redacted]`, nested objects → `[object]`, strings masked + capped at 200 chars. |
| `safeMetadataForPersistence(input)` | Recursive sanitiser for persistent storage: redacts sensitive keys, scrubs PII/tokens, caps depth (3 levels), key count (25), array size (20), and string length (200 chars). |

**Backward-compat aliases** (`isSensitiveKey`, `scrubValue`) remain in the
`@/lib/observability/redaction` shim for existing deep imports. **New code must
import from `@/lib/security/redaction` or `@/lib/security` directly.**

### Sensitive-key superset

Any key whose name (case-insensitive substring match) contains one of:
`authorization`, `body`, `completion`, `content`, `cookie`, `credential`,
`definition`, `email`, `example`, `explanation`, `key`, `pass`, `phrase`,
`prompt`, `pwd`, `response`, `secret`, `select`, `sentence`, `session`,
`text`, `token`, `translation`, `url`.

This superset covers keys from all three prior per-module lists (audit, errors,
analytics) — the regression test in `tests/redaction.test.ts` validates that no
path narrows the superset.

### Consuming paths

| Path | How it uses the shared policy |
| --- | --- |
| `src/lib/security/audit.ts` | `isSensitiveMetadataKey` + `redactSensitiveValue` for `sanitizeAuditMetadata` |
| `src/lib/observability/errors.ts` | `isSensitiveMetadataKey` + `redactSensitiveValue` for `scrubContext` (used by security events) |
| `src/lib/analytics/events/sanitize.ts` | `isSensitiveMetadataKey` for `sanitizeEventProperties` (drops sensitive keys) |
| `src/lib/ai/ledger.ts` | `redactSensitiveValue` for error messages before persistence |
| `src/lib/security/events.ts` | via `scrubContext` from `@/lib/observability/errors` |
