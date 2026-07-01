---
type: "policy"
status: "current"
last_updated: "2026-07-01"
description: "Documents abuse-prevention signals, rate limits, mitigation hooks, and implemented/proposed control boundaries. Captures current thresholds, route scopes, provider-fallback behavior, monitoring signals, and future design targets."
---

# Abuse prevention controls

ReadWise abuse prevention is currently built from point-of-call controls:
rate limits, quotas, SSRF protections, provider budgets, audit logs, and
security-event recording. There is no separate product-level risk scoring table
or account-wide abuse state machine.

This document records the controls that are enforced in the current codebase.

## Shared primitives

| Primitive | Source | Current role |
| --- | --- | --- |
| Fixed-window rate limiter | `src/lib/security/rate-limit/index.ts` | DB-backed counters with in-memory fallback. Scopes include `ai`, `import`, `lookup`, `public`, `admin-job`, and `auth`. |
| AI budget / quota | `src/lib/ai/budget.ts` | Per-user, per-feature, global-interactive, and global-background counters. Interactive calls throw `429`; background calls degrade gracefully. |
| Import daily quota | `src/lib/import/quota.ts` | Five new imported articles per user per UTC day. Checked after de-duplication and before DB write. |
| SSRF guard | `src/lib/scraper/ssrf.ts` | Validates and pins DNS for outbound fetches; blocks private/metadata IPs. |
| Robots.txt check | `src/lib/scraper/robots.ts` | Fail-open crawl-policy cache used by scraper providers. |
| Scraper runtime limits | `src/lib/runtime-config/scraper.ts` | Max response bytes, timeout, and redirect caps for scraper fetches. |
| TTS character cap | `src/lib/speech/index.ts` | Caps synthesis input at `MAX_TTS_CHARS = 5000`. |
| Security events | `src/lib/security/events.ts` | In-memory ring buffer for structured security events and spike detection. |
| Trusted client IP resolution | `src/lib/security/client-ip.ts` | Trusted-proxy-aware client IP extraction. |
| Audit log | `src/lib/security/audit.ts` | Durable DB log for admin/security-sensitive actions. |

## URL imports

`POST /api/reader/import/url` is guarded by:

- import-scope rate limiting;
- per-user daily import quota;
- raw URL de-duplication before scrape work consumes quota or network;
- SSRF validation before outbound fetch;
- scraper byte, timeout, redirect, and robots controls;
- `import.blocked` and `import.failed` security events for blocked or failed
  fetches.

The endpoint must not log imported article text or private content. Security
events use metadata such as reason/status, not article bodies.

## Text imports

`POST /api/reader/import/text` uses the same import-scope rate limit and daily
quota as URL imports. The route validates text length and minimum word count
before writing an article, so oversized or too-short payloads fail without
creating rows.

Pasted text is private user content and must not be copied into logs, analytics
properties, audit metadata, or security-event metadata.

## AI feature calls

Interactive AI calls are protected by two layers:

1. request-rate limiting for the `ai` scope;
2. AI budget checks for user, feature, and global windows.

`assertAiQuota` throws a user-visible `429` for interactive quota breaches.
`checkAiBudget` is non-throwing for background work, allowing workers to skip AI
calls gracefully when configured limits are reached. Usage and estimated cost
are tracked through the AI invocation ledger as metadata only; prompts and model
responses are not persisted there.

## Speech and TTS

Speech generation and token endpoints are constrained by:

- readable-article access checks before synthesis;
- cached `ArticleSpeech` rows to avoid repeat synthesis;
- `MAX_TTS_CHARS = 5000` per synthesis request;
- lookup-scope rate limiting for speech token issuance.

Generated narration text and word-boundary payloads are content-derived and must
not appear in logs.

## Admin scrape and job controls

Admin-triggered scraper and backfill flows require admin session guards and use
the `admin-job` rate-limit scope. Durable audit events record admin actions such
as scrape triggers and backfill requests with metadata such as provider, mode,
feature list, reason, and counts.

Admin metadata must stay content-free: no article body, prompts, provider
credentials, or user-private text.

## Push subscription churn

Push subscribe/unsubscribe routes are authenticated and rate-limited through the
lookup scope. Subscriptions are upserted by endpoint, so re-subscribing the same
browser endpoint is idempotent rather than creating unbounded duplicate rows.

Push endpoint URLs and crypto keys are sensitive and must never be logged.

## Client-error reporting

`POST /api/client-errors` is public-IP rate limited and always returns `204` so
clients cannot infer whether an event was accepted or dropped. Reported message,
stack, and URL fields are bounded by validation and scrubbed before logging;
query strings and hashes are stripped from URLs.

## Privacy rules

Abuse-prevention controls may log or aggregate coarse metadata such as status
codes, rate-limit scope, feature name, provider key, counts, or controlled reason
codes. They must not persist or log:

- article text or imported text;
- selected/highlighted text or private notes;
- prompts, completions, or AI responses;
- word definitions, examples, or context sentences;
- credentials, tokens, cookies, push keys, or provider secrets;
- raw email addresses or other PII.

All metadata paths should use the security-owned redaction policy documented in
[`overview.md`](./overview.md).