---
title: "ADR-0004: Shared server-side rate limiting"
category: "Architecture"
architecture: "Architecture decision record for shared fixed-window rate limiting and fallback behavior."
design: "Captures rate-limit store decision, DB/memory fallback, request scopes, and operational consequences."
plan: "Supersede with a new ADR if rate-limiting architecture changes; update runtime/security docs for knob changes."
updated: "2026-07-01"
rename: "none"
---

# ADR-0004: Shared server-side rate limiting

- **Status:** Accepted
- **Date:** 2026-06-22
- **Related:** #284 (RW-026), #277 (RW-019), #280 (RW-022), #324 (RW-066)

## Context

ReadWise has endpoints that can trigger AI, scraping, speech synthesis, dictionary lookups, and client error reporting. Per-route ad hoc throttles would be inconsistent and easy to bypass.

## Decision

Introduce a shared server-side rate-limiting module used by API routes and worker-triggering paths. Limits should support user, IP, and feature keys, return consistent 429 responses, and emit structured logs with request ids.

## Alternatives considered

- **Client-side throttling only:** Improves UX but does not protect services.
- **One-off limits per route:** Quick, but inconsistent and hard to tune.
- **Provider-only quotas:** Helpful backstop, but too late to protect ReadWise UX or costs.

## Consequences

- Expensive and abuse-prone features can share predictable enforcement.
- Tests should cover key generation and 429 behavior for sensitive routes.
- Storage may start simple but must move to a shared backend when multiple app instances are used.

## Follow-up work

- [x] #284: implement shared rate limiting.
- [x] Align AI budgets in #280 with rate-limit keys where possible.
