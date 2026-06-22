# ADR-0001: PostgreSQL as the primary durable database

- **Status:** Proposed
- **Date:** 2026-06-22
- **Related:** #259 (RW-001), #314 (RW-056), #324 (RW-066)

## Context

ReadWise currently uses Prisma with SQLite for local development. Wave 1 adds private content, stricter authorization, audit trails, jobs, analytics, and later multi-tenant features; these need stronger concurrency, migrations, indexes, and integration-test parity than SQLite can provide.

## Decision

Use PostgreSQL as the primary durable database for shared, test, and production environments. Keep Prisma as the ORM boundary. SQLite may remain a lightweight local option only while it does not hide behavior that matters to production.

## Alternatives considered

- **Stay on SQLite:** Simple, but weak for concurrent workers, locking semantics, and production-like tests.
- **Use another relational database:** MySQL would work, but PostgreSQL has stronger default support for JSON, locking, partial indexes, and future analytics needs.
- **Add a non-relational store first:** Too early; the core domain is relational.

## Consequences

- Production behavior and integration tests can share one database engine.
- Migrations must be reviewed more carefully because PostgreSQL becomes an operational dependency.
- Local setup needs a documented Postgres path before SQLite-only assumptions are removed.

## Follow-up work

- [ ] #259: migrate Prisma schema and runtime configuration to PostgreSQL.
- [ ] #314: add real database migration and integration tests.
