# ADR-0005: Persistent job table before external queues

- **Status:** Proposed
- **Date:** 2026-06-22
- **Related:** #271 (RW-013), #272 (RW-014), #273 (RW-015), #274 (RW-016), #324 (RW-066)

## Context

The current processor and worker discover work from article state. Wave 2 needs retries, dead-letter handling, multi-worker safety, and step-level processing visibility without forcing an external queue decision too early.

## Decision

Add a persistent database-backed job table with explicit state, attempts, next-run time, locked-by/locked-until fields, and error summaries. Use PostgreSQL row locking for multi-worker coordination. Keep job execution idempotent by continuing to call cache-first processing helpers.

## Alternatives considered

- **Keep polling article state only:** Simple, but lacks scheduling, backoff, and dead-letter visibility.
- **Adopt Redis/BullMQ now:** Powerful, but adds infrastructure before job semantics are proven.
- **Use hosted queues immediately:** Good later, but makes local development and tests more complex now.

## Consequences

- Failed and delayed work becomes inspectable in the database.
- Database load must be monitored as worker volume grows.
- The job table can later become the outbox feeding Redis or a hosted queue if needed.

## Follow-up work

- [ ] #271: add persistent job table.
- [ ] #272: implement multi-worker locking.
- [ ] #273: define retry and dead-letter policy.
- [ ] #274: track article processing at step level.
