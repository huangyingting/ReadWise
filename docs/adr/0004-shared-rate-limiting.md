# ADR-0004: Shared server-side rate limiting

- **Status:** Proposed
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

- [ ] #284: implement shared rate limiting.
- [ ] Align AI budgets in #280 with rate-limit keys where possible.
