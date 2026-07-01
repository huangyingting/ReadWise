---
title: "ADR-0001: PostgreSQL as the primary durable database"
category: "Architecture"
architecture: "Architecture decision record for database direction and SQLite/PostgreSQL parity."
design: "Captures decision context, chosen database posture, consequences, and migration expectations."
plan: "Supersede with a new ADR if database strategy changes; keep implementation docs aligned separately."
updated: "2026-07-01"
rename: "none"
---

# ADR-0001: PostgreSQL as the primary durable database

- **Status:** Accepted
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

## Current status

- PostgreSQL Prisma schema/runtime configuration and the local parity workflow
	exist.
- PostgreSQL migration and integration-test paths exist.
- SQLite remains the lightweight local default; shared/production environments
	should use managed PostgreSQL where available.
