# ReadWise documentation index

This directory contains the durable reference documentation for the current
ReadWise codebase. Keep feature docs aligned with code under `src/`, the Prisma
schemas under `prisma/`, and scripts in `package.json` / `scripts/`.

## Start here

| Document | Scope |
| --- | --- |
| [`../README.md`](../README.md) | Project overview, local setup, scripts, deployment, and high-level architecture. |
| [`database.md`](./database.md) | SQLite and PostgreSQL workflows, local parity stack, migration testing, and data migration notes. |
| [`operations/database-runbooks.md`](./operations/database-runbooks.md) | Backup, restore, rollback, and disaster-recovery runbooks. |
| [`ci.md`](./ci.md) | CI quality gates, required checks, E2E tiers, and failure diagnosis. |

## Product and learning systems

| Document | Scope |
| --- | --- |
| [`learning-and-mastery.md`](./learning-and-mastery.md) | Word/article/skill mastery, learner analytics, adaptive leveling, streaks, SRS, and study-plan signals. |
| [`reader-annotations.md`](./reader-annotations.md) | Highlights, notes, anchor revalidation, offline note merge, and reader annotation APIs. |
| [`offline-sync.md`](./offline-sync.md) | Offline mutation queue, conflict resolution, cache versioning, background-sync resilience, and push reminders. |
| [`search-and-indexing.md`](./search-and-indexing.md) | Search and indexing strategy. |
| [`analytics.md`](./analytics.md) | Product analytics event stream, retention, dashboards, and privacy rules. |
| [`multi-tenancy.md`](./multi-tenancy.md) | Organizations, memberships, classrooms, assignments, tenant-aware cache keys, and tenant analytics privacy. |
| [`rbac.md`](./rbac.md) | Capability-based authorization for global roles and tenant/classroom memberships. |

## AI, content, and operations

| Document | Scope |
| --- | --- |
| [`ai-context.md`](./ai-context.md) | AI provider abstraction, long-context chunking, cache versioning, and graceful fallbacks. |
| [`ai-prompts.md`](./ai-prompts.md) | Prompt registry, prompt versions, and backfill/rebuild guidance. |
| [`ai-safety.md`](./ai-safety.md) | Structured output validation, moderation, provider error normalization, and safe fallbacks. |
| [`ai-evals.md`](./ai-evals.md) | Offline/live AI evaluation harness and datasets. |
| [`content-policy.md`](./content-policy.md) | Source governance, provider health, rights metadata, review, and takedown workflow. |
| [`scrapers.md`](./scrapers.md) | Scraper providers, discovery/extraction, SSRF/robots controls, and provider drift handling. |
| [`media-storage.md`](./media-storage.md) | Database/filesystem/Azure media storage and speech-audio migration. |
| [`admin-operations.md`](./admin-operations.md) | Persistent job queue, processing-step state, audit logs, provider operations, admin endpoints, and operator workflows. |
| [`health-readiness.md`](./health-readiness.md) | `/api/health`, `/api/ready`, runtime config validation, migrations, and optional-provider degradation. |

## Security and observability

| Document | Scope |
| --- | --- |
| [`security.md`](./security.md) | Trusted proxy/IP handling, CSRF, destructive-action protections, security events, and audit-log relationship. |
| [`observability.md`](./observability.md) | Tracing, error aggregation, metrics, SLOs, and investigation workflow. |

## Architecture decisions

| Document | Scope |
| --- | --- |
| [`adr/`](./adr/) | Architecture decision records. Start with [`adr/README.md`](./adr/README.md). |

## Maintenance rules

- Prefer updating these durable docs over adding ad-hoc notes.
- Historical spikes belong under `docs/spikes/` only while they are actively
  useful. Delete or promote them once code/ADR/reference docs supersede them.
- Keep environment-variable tables consistent with `.env.example` and
  `src/lib/config.ts`.
- Keep script examples consistent with `package.json` and `scripts/*.ts` help
  output.
- Keep schema/model descriptions consistent with both `prisma/schema.prisma` and
  `prisma/postgresql/schema.prisma` when PostgreSQL parity is affected.
