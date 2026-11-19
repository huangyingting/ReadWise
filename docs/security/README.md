---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Request protections, abuse prevention, and the data classification and retention matrix."
---

# Security

Redaction policy, CSRF, trusted client IP, rate limiting, security events, request limits, and data lifecycle rules (ADR [0003](../architecture/0003-admin-security-audit-logs.md), [0004](../architecture/0004-shared-rate-limiting.md)). Operator-facing security workflows are in [`../operations/security-audit.md`](../operations/security-audit.md).

Add a document here when the change affects request protections, sensitive data handling, retention, or abuse controls.

## Code ownership

- `src/lib/security/`
- `src/lib/api-handler.ts` (CSRF, body cap, security events)
- `prisma/` models covered by the data lifecycle matrix

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Abuse prevention controls](./abuse-prevention.md) | policy | current | Documents abuse-prevention signals, rate limits, mitigation hooks, and implemented/proposed control boundaries. Captures current thresholds, route scopes, provider-fallback behavior, monitoring signals, and future design targets. |
| [Data classification and retention matrix](./data-lifecycle-matrix.md) | reference | current | Documents data classification, retention, export, cascade, and privacy treatment across Prisma models and client stores. Captures current model-by-model classification, deletion behavior, retention windows, export handling, and follow-up gaps. |
| [Security: trusted proxy/IP, CSRF, security events & audit logs](./overview.md) | reference | current | Documents security subsystem boundaries for client IP, CSRF, security events, audit logs, redaction, and rate limiting. Captures current trusted-proxy strategies, same-origin enforcement, event monitoring, redaction policy, and audit-log relationship. |

<!-- END GENERATED: docs-index -->
