---
type: "runbook"
status: "current"
last_updated: "2026-07-01"
description: "Documents the admin security surface, in-memory security event buffer, durable AuditLog table, and their relationship to observability and security controls. Operators use /admin/security for recent security events and /api/admin/audit-logs for durable filtered history; both surfaces expose metadata only and rely on shared redaction."
---

# Security event and audit-log operations

This runbook explains how operators inspect recent security signals and durable
audit history from the admin surface. It complements the security architecture
document, which owns the underlying trusted-proxy, CSRF, event, and redaction
rules.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Admin page | `src/app/admin/security/page.tsx` | Security events UI under `/admin/security`. |
| Event API | `src/app/api/admin/security/events/route.ts` | Recent in-memory security events, filtered for admin inspection. |
| Audit API | `src/app/api/admin/audit-logs/route.ts` | Durable `AuditLog` reads with filters and pagination. |
| Security events | `src/lib/security/events.ts` | Ring buffer, metrics, spike detection, alert escalation. |
| Audit logs | `src/lib/security/audit.ts` | Append-only admin/account action history and request metadata. |
| Redaction | `src/lib/security/redaction.ts` | Shared sensitive-key/value redaction policy. |
| Runtime config | `src/lib/runtime-config/security.ts` | Trusted proxy, CSRF, security-event thresholds, audit retention. |
| Metrics | `src/lib/metrics/*`, `/api/admin/metrics` | Security-event counters and Prometheus-style export. |

## Recent security events

`GET /api/admin/security/events` is admin-only and returns the in-memory ring
buffer, newest first. Query parameters:

| Parameter | Meaning |
| --- | --- |
| `limit` | Maximum rows to return. |
| `type` | Filter by event type, such as `csrf.blocked` or `rate_limit.exceeded`. |
| `severity` | Filter by severity. |

The ring buffer is intentionally ephemeral. It is useful for immediate triage,
but not for compliance history. Forward structured `security.event` log lines
and metrics to the deployment log/SIEM pipeline for durable operational alerts.

## Durable audit logs

`GET /api/admin/audit-logs` reads the `AuditLog` table with filters such as
`page`, `pageSize`, `action`, `actorId`, and `targetType`. Reading audit logs is
itself audited as `admin.audit_logs.read`.

Audit rows are append-only metadata:

- `actorId` and `targetId` are plain strings, not foreign keys, so user/article
  deletion never erases investigation history;
- `metadata` is sanitized JSON and must never contain secrets, article text,
  selected text, prompts, definitions, translations, or private notes;
- `requestId`, trusted client IP, and user agent support correlation with logs
  and traces.

## Triage workflow

### Suspicious rate-limit spike

1. Open `/admin/security` and filter for `rate_limit.exceeded`.
2. Group by actor/IP in the displayed metadata. If trusted proxy config is unset,
   treat IP attribution as best-effort and potentially spoofable.
3. Check `/api/admin/metrics` for `readwise_security_events_total` and route
   request counters.
4. Review audit logs for admin/account actions from the same actor.
5. Mitigate at the edge or by tightening rate-limit scopes; do not copy request
   bodies or selected text into incident notes.

### CSRF blocked events

1. Filter recent events for `csrf.blocked`.
2. Verify the blocked route and origin. Expected same-origin app requests should
   not be blocked.
3. If a legitimate deployment origin is missing, update `CSRF_ALLOWED_ORIGINS`
   and redeploy.
4. Keep `CSRF_ENFORCE` enabled unless a separate, documented CSRF layer fronts
   every mutation route.

### Admin denied or unexpected mutation

1. Filter security events for `auth.admin_denied` or `admin.mutation`.
2. Query `GET /api/admin/audit-logs?action=<action>` around the same time.
3. Use `requestId` to correlate structured logs and traces.
4. For destructive actions, verify the admin UI confirmation and capability guard
   path in the route code.

## Retention and configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `SECURITY_EVENT_ALERT_THRESHOLD` | `10` | Spike threshold for same event actor/IP. |
| `SECURITY_EVENT_WINDOW_MS` | `60000` | Rolling spike-detection window. |
| `SECURITY_EVENT_BUFFER_SIZE` | `200` | In-memory event buffer, capped to 2000. |
| `AUDIT_LOG_RETENTION_DAYS` | `730` | Audit pruning window. |
| `TRUSTED_PROXY_HEADER` / `TRUSTED_PROXY_LIST` / `TRUSTED_PROXY_HOPS` | unset | Deployment-specific trusted client-IP strategy. |
| `CSRF_ALLOWED_ORIGINS` | unset | Extra allowed origins beyond app/NextAuth origins. |
| `CSRF_ENFORCE` | on | Same-origin enforcement for app mutation routes. |

## Privacy rules for operators

- Do not paste raw request bodies, article text, selected text, prompts,
  translations, notes, tokens, cookies, or credentials into audit metadata,
  incident summaries, or ticket fields.
- Use low-cardinality identifiers, counts, statuses, route paths, and request ids
  for investigation.
- If a report requires sensitive context, store it in the approved secure support
  system, not in `AuditLog.metadata` or security event metadata.

## Related docs

- [`../security/overview.md`](../security/overview.md) — security architecture and redaction policy.
- [`admin-operations.md`](./admin-operations.md) — broader admin operations surface.
- [`../observability/overview.md`](../observability/overview.md) — logs, traces, metrics, and SLO triage.
- [`../security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md) — retention/privacy classification.
