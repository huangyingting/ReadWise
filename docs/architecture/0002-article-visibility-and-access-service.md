# ADR-0002: Explicit article visibility with centralized access checks

- **Status:** Accepted
- **Date:** 2026-06-22
- **Related:** #260 (RW-002), #261 (RW-003), #266 (RW-008), #267 (RW-009), #324 (RW-066)

## Context

ReadWise is moving from public curated articles toward private imports and safer reader/admin boundaries. Scattered Prisma queries make it easy to forget owner, visibility, status, or source-type filters and create IDOR risk.

## Decision

Represent article lifecycle and visibility explicitly, and route article reads/writes through a centralized article access service. Pages and API routes should ask the service for user-scoped article access instead of hand-rolling authorization filters.

## Alternatives considered

- **Continue inline query filters:** Fast to write, but authorization drift is likely.
- **Middleware-only enforcement:** Middleware cannot inspect row-level ownership or lifecycle state.
- **Database row-level security now:** Strong, but premature before the tenant model and PostgreSQL migration settle.

## Consequences

- Authorization rules become easier to test and audit.
- New article features must use the service rather than direct broad Prisma reads.
- The service needs regression coverage for private article lifecycle and IDOR cases.

## Follow-up work

- [x] #260: add explicit article visibility/status/source-type fields.
- [x] #261: enforce safe private article lifecycle.
- [x] #266: centralize article access.
- [x] #267: add IDOR regression tests.
