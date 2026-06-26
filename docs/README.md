# ReadWise documentation index

This directory contains the durable reference documentation for the current
ReadWise codebase. Documentation is organized by subsystem. Each subsystem
directory stays flat: add documents directly under the subsystem directory rather
than creating nested folders.

Keep feature docs aligned with code under `src/`, the Prisma schemas under
`prisma/`, and scripts in `package.json` / `scripts/`.

## Start here

| Document | Scope |
| --- | --- |
| [`../README.md`](../README.md) | Project overview, local setup, scripts, deployment, and high-level architecture. |
| [`platform/database.md`](./platform/database.md) | SQLite and PostgreSQL workflows, local parity stack, migration testing, and data migration notes. |
| [`platform/database-runbooks.md`](./platform/database-runbooks.md) | Backup, restore, rollback, and disaster-recovery runbooks. |
| [`platform/ci.md`](./platform/ci.md) | CI quality gates, required checks, E2E tiers, and failure diagnosis. |

## Subsystems

### Access and tenancy

| Document | Scope |
| --- | --- |
| [`access/account-lifecycle.md`](./access/account-lifecycle.md) | Account export, self-service deletion, admin member deletion/role changes, support actions, cascades, and last-admin guards. |
| [`access/multi-tenancy.md`](./access/multi-tenancy.md) | Organizations, memberships, classrooms, assignments, tenant-aware cache keys, and tenant analytics privacy. |
| [`access/rbac.md`](./access/rbac.md) | Capability-based authorization for global roles and tenant/classroom memberships. |

### AI

| Document | Scope |
| --- | --- |
| [`ai/context-management.md`](./ai/context-management.md) | AI provider abstraction, long-context chunking, cache versioning, and graceful fallbacks. |
| [`ai/prompts.md`](./ai/prompts.md) | Prompt registry, prompt versions, and backfill/rebuild guidance. |
| [`ai/safety.md`](./ai/safety.md) | Structured output validation, moderation, provider error normalization, and safe fallbacks. |
| [`ai/evaluations.md`](./ai/evaluations.md) | Offline/live AI evaluation harness and datasets. |
| [`ai/governance-ledger.md`](./ai/governance-ledger.md) | AI invocation ledger, budgets/quotas, usage summaries, cost estimates, and privacy boundaries. |

### Analytics

| Document | Scope |
| --- | --- |
| [`analytics/product-analytics.md`](./analytics/product-analytics.md) | Product analytics event stream, retention, dashboards, and privacy rules. |

### Architecture

| Document | Scope |
| --- | --- |
| [`architecture/`](./architecture/) | Architecture decision records. Start with [`architecture/README.md`](./architecture/README.md). |
| [`architecture/0010-subsystem-boundaries-and-import-contracts.md`](./architecture/0010-subsystem-boundaries-and-import-contracts.md) | First-class subsystem ownership model, public API and private import rules, allowlist strategy, and phased enforcement backlog. New work must respect the subsystem boundary contract defined here. |

### Content ingestion and policy

| Document | Scope |
| --- | --- |
| [`content/article-library.md`](./content/article-library.md) | Article access policy, lifecycle axes, public/private listings, admin article operations, moderation, and content safety boundaries. |
| [`content/content-policy.md`](./content/content-policy.md) | Source governance, provider health, rights metadata, review, and takedown workflow. |
| [`content/legal-content.md`](./content/legal-content.md) | Legal/static content responsibilities. |
| [`content/scrapers.md`](./content/scrapers.md) | Scraper providers, discovery/extraction, SSRF/robots controls, and provider drift handling. |
| [`content/extraction-quality.md`](./content/extraction-quality.md) | Content extraction quality signals, composite score, and scraper drift triage workflow. |

### Learning

| Document | Scope |
| --- | --- |
| [`learning/engagement-analytics.md`](./learning/engagement-analytics.md) | Reading progress, daily activity, streaks, shields, heatmaps, and reading-speed signals. |
| [`learning/learning-and-mastery.md`](./learning/learning-and-mastery.md) | Word/article/skill mastery, learner analytics, adaptive leveling, streaks, SRS, and study-plan signals. |
| [`learning/profile-preferences.md`](./learning/profile-preferences.md) | Onboarding/profile validation, CEFR/topics/daily-goal preferences, level history, and personalization consumers. |

### Media

| Document | Scope |
| --- | --- |
| [`media/storage.md`](./media/storage.md) | Database/filesystem/Azure media storage and speech-audio migration. |

### Observability

| Document | Scope |
| --- | --- |
| [`observability/client-error-reporting.md`](./observability/client-error-reporting.md) | Browser runtime error sink, scrubbing, rate limiting, aggregation, and alerting behavior. |
| [`observability/overview.md`](./observability/overview.md) | Tracing, error aggregation, metrics, SLOs, and investigation workflow. |

### Operations

| Document | Scope |
| --- | --- |
| [`operations/admin-operations.md`](./operations/admin-operations.md) | Persistent job queue, processing-step state, audit logs, provider operations, admin endpoints, and operator workflows. |

### Platform

| Document | Scope |
| --- | --- |
| [`platform/api-catalog.md`](./platform/api-catalog.md) | Generated API catalog. |
| [`platform/api-catalog.json`](./platform/api-catalog.json) | Machine-readable generated API catalog. |
| [`platform/authentication.md`](./platform/authentication.md) | NextAuth provider registry, database sessions, first-user admin bootstrap, cookie posture, and auth guard layering. |
| [`platform/ci.md`](./platform/ci.md) | CI quality gates, required checks, E2E tiers, and failure diagnosis. |
| [`platform/database.md`](./platform/database.md) | SQLite and PostgreSQL workflows, local parity stack, migration testing, and data migration notes. |
| [`platform/database-runbooks.md`](./platform/database-runbooks.md) | Backup, restore, rollback, and disaster-recovery runbooks. |
| [`platform/dependency-injection.md`](./platform/dependency-injection.md) | Dependency injection seams and testing guidance. |
| [`platform/health-readiness.md`](./platform/health-readiness.md) | `/api/health`, `/api/ready`, runtime config validation, migrations, and optional-provider degradation. |
| [`platform/runtime-config.md`](./platform/runtime-config.md) | Runtime configuration ownership, typed helpers, and the documented `process.env` allowlist. |
| [`platform/push-notifications.md`](./platform/push-notifications.md) | Web Push configuration, subscription lifecycle, reminder scheduling, delivery health, and privacy. |
| [`platform/static-assets.md`](./platform/static-assets.md) | Static asset and public file guidance. |

### Reader

| Document | Scope |
| --- | --- |
| [`reader/bookmarks-and-lists.md`](./reader/bookmarks-and-lists.md) | Default Saved list, custom reading lists, list membership, IDOR protections, and export/deletion behavior. |
| [`reader/imports.md`](./reader/imports.md) | URL/text personal imports, SSRF and sanitization controls, de-duplication, daily quota, audit, and analytics metadata. |
| [`reader/lexical-dictionary.md`](./reader/lexical-dictionary.md) | Dictionary lookup provider seam, word normalization, saved-word persistence, mastery exposure, and privacy rules. |
| [`reader/offline-sync.md`](./reader/offline-sync.md) | Offline mutation queue, conflict resolution, cache versioning, background-sync resilience, and push reminders. |
| [`reader/annotations.md`](./reader/annotations.md) | Highlights, notes, anchor revalidation, offline note merge, and reader annotation APIs. |
| [`reader/recommendations.md`](./reader/recommendations.md) | Scored Picks candidate boundary, per-user context, scoring weights, diversity pass, explanations, and privacy. |
| [`reader/search-and-indexing.md`](./reader/search-and-indexing.md) | Search and indexing strategy. |
| [`reader/speech-synthesis.md`](./reader/speech-synthesis.md) | Narration access checks, Azure Speech provider seam, speech cache lifecycle, storage fallback, and streaming playback. |
| [`reader/translation.md`](./reader/translation.md) | Full-article and sentence translation cache keys, chunking, prompt versions, fallbacks, and privacy boundaries. |

### Security

| Document | Scope |
| --- | --- |
| [`security/overview.md`](./security/overview.md) | Trusted proxy/IP handling, CSRF, destructive-action protections, security events, and audit-log relationship. |

## Maintenance rules

- Prefer updating these durable docs over adding ad-hoc notes.
- Historical spikes belong under `docs/spikes/` only while they are actively
  useful. Delete or promote them once code/architecture/reference docs supersede
  them.
- Keep environment-variable tables consistent with `.env.example` and
  `src/lib/runtime-config/`.
- Keep script examples consistent with `package.json` and `scripts/*.ts` help
  output.
- Keep schema/model descriptions consistent with both `prisma/schema.prisma` and
  `prisma/postgresql/schema.prisma` when PostgreSQL parity is affected.
