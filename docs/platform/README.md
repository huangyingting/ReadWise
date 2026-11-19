---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Shared infrastructure: API handler and catalog, authentication foundation, database and runbooks, CI, runtime config, health, push, i18n, primitives, testing data, and supply chain."
---

# Platform

Common infrastructure that domains build on. Platform provides the foundation; domains own business decisions (ADR [0001](../architecture/0001-postgresql-primary-database.md), [0010](../architecture/0010-subsystem-boundaries-and-import-contracts.md)).

Add a document here when the change affects cross-cutting infrastructure, conventions, CI, configuration, or how documentation itself is maintained.

## Code ownership

- `src/lib/api-handler.ts`, `src/lib/validation.ts`, `src/tools/api-catalog.ts`
- `src/lib/auth/`, `src/lib/runtime-config/`, `src/lib/database/`, `src/lib/prisma.ts`
- `src/lib/push/`, `src/lib/i18n/`, `src/lib/primitives/`, `src/lib/http/`
- `prisma/`, `scripts/`, `.github/workflows/ci.yml`

Generated artifact: [`api-catalog.json`](./api-catalog.json) (machine-readable API catalog, written by `npm run api-catalog` with `api-catalog.md`).

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [ReadWise API Catalog](./api-catalog.md) | catalog | generated | Generated inventory of Next.js API route boundaries, auth modes, schemas, and response formats. Generated from src/app/api route handlers by src/tools/api-catalog.ts; do not edit by hand. |
| [Authentication architecture](./authentication.md) | reference | current | Documents NextAuth provider registry, database and password sessions, explicit social linking, operator admin bootstrap, cookies, and auth guard layering. |
| [Continuous Integration & release readiness](./ci.md) | testing | current | Documents CI quality gates, production container builds, native coverage, test tiers, isolated Playwright configuration, UI audit sharding/artifacts, generated-doc drift checks, and release-readiness automation. |
| [Database backup, restore, migration, and rollback runbooks](./database-runbooks.md) | runbook | current | Documents database operational runbooks for backup, restore, migration, rollback, and disaster recovery. Captures current SQLite/PostgreSQL procedures, validation checks, rollback safety, and operator actions. |
| [Database setup](./database.md) | reference | current | Documents SQLite/PostgreSQL database setup, schema generation, migration workflows, local parity stack, and performance tuning entry points. Captures current Prisma schemas, DATABASE_URL/PRISMA_SCHEMA_PATH usage, migration tests, and data migration notes. |
| [Dependency injection and test seam patterns](./dependency-injection.md) | design | current | Documents dependency-injection seams and testability boundaries across platform/domain modules. Captures current injectable interfaces, default implementations, test seams, and anti-patterns. |
| [Documentation governance and metadata](./documentation-governance.md) | policy | current | The documentation contract for docs/: flat subsystem directories with generated README indexes, required frontmatter, document types and statuses, rename/merge/delete decisions, freshness rules, and the docs:check enforcement. |
| [Health, readiness and runtime configuration](./health-readiness.md) | reference | current | Documents /api/health, /api/ready, runtime configuration validation, migration checks, and optional-provider degradation. Captures current readiness JSON, provider check semantics, database/migration validation, and non-secret reporting. |
| [UI internationalization](./internationalization.md) | reference | current | Documents UI i18n architecture, locale loading, and separation from article translation and learner preferences. Captures current catalog structure, translation lookup behavior, fallback rules, and contribution guidance. |
| [Platform Primitives](./primitives.md) | reference | current | Documents shared platform primitive ownership and relationship to src/lib/primitives/README.md. Captures current primitive classification, contribution guidelines, stability expectations, and import rules. |
| [Push notifications and study reminders](./push-notifications.md) | design | current | Documents Web Push configuration, subscription lifecycle, reminder scheduler, and delivery-health boundaries. Captures current VAPID config, preference model, quiet hours, delivery pruning, push routes, and privacy rules. |
| [Runtime configuration and process.env allowlist](./runtime-config.md) | reference | current | Documents server-side runtime-config ownership, the direct process.env allowlist, typed environment helpers, and narrow build/test/maintenance adapters. Captures current env-var ownership, feature switches, optional-provider config, and server-only import boundaries. |
| [Schema-change privacy and retention checklist](./schema-change-checklist.md) | policy | current | Documents privacy, retention, export, cascade, and migration checks required for Prisma schema changes. Captures current model-change checklist, SQLite/PostgreSQL parity expectations, generated-schema updates, and documentation requirements. |
| [Static Asset Governance](./static-assets.md) | reference | current | Documents public/static asset ownership, caching, icons/fonts/PWA files, and update boundaries. Captures current static-file conventions, service-worker/manifest interactions, cache rules, and review requirements. |
| [Supply-chain and dependency hygiene](./supply-chain.md) | policy | current | Documents dependency hygiene, vulnerability response, CI gates, and package-management boundaries. Captures current dependency review, lockfile expectations, advisory response, and upgrade verification workflow. |
| [Test data and fixture governance](./test-data-governance.md) | policy | current | Documents ownership and privacy boundaries for unit fixtures, seeds, e2e data, scraper corpora, and AI eval datasets. Captures current fixture rules, generated/test data lifecycle, privacy constraints, and maintenance workflow. |

<!-- END GENERATED: docs-index -->
