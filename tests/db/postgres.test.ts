/**
 * PostgreSQL integration test suite entry point.
 *
 * Tests have been split into focused domain files; shared helpers live in
 * tests/db/support/.  This file re-exports the configuration constants so
 * that any tooling that imports postgres.test.ts directly still resolves.
 *
 * Domain files:
 *   - postgres-migrations.test.ts  — baseline migration and SQL-from-scratch tests
 *   - postgres-privacy.test.ts     — audit logs, JSON fields, ownership, tag scoping, privacy checks
 *   - postgres-cascade.test.ts     — article delete cascade behaviour
 *   - postgres-search.test.ts      — full-text search and privacy filtering
 *   - postgres-jobs.test.ts        — worker processor, Job table, claimNextJob, failJob
 *   - postgres-indexes.test.ts     — query-plan index assertions
 *
 * Support modules (tests/db/support/):
 *   - db-config.ts        — enabled / isPostgres / PREFIX constants
 *   - db-helpers.ts       — id(), cleanIntegrationRows(), SQL utilities, migration loader
 *   - explain-helpers.ts  — EXPLAIN helpers and index assertions
 *   - fixtures.ts         — seedQueryPlanFixture()
 */

export { enabled, isPostgres, PREFIX } from "./support/db-config";
