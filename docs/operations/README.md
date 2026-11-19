---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Running ReadWise: the job queue and worker, admin operations, releases and VM deployment, incident response, capacity, provider operations, and performance tuning."
---

# Operations

Background processing and operator workflows (ADR [0005](../architecture/0005-persistent-job-table-and-worker-locking.md)). Operations owns scheduling, retries, and recovery; domains own the work itself.

Add a document here when the change affects jobs, the worker, deployment, runbooks, or operator-facing admin tools.

## Code ownership

- `src/lib/jobs/`, `src/lib/worker/`, `src/lib/processing/`, `src/lib/retention/`
- `src/lib/admin/`, `src/app/admin/jobs/`
- `.github/workflows/deploy-vm.yml`, `Dockerfile`, `Dockerfile.ops`, `ops/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Admin operations, jobs and audit logs](./admin-operations.md) | runbook | current | Documents Operations-owned admin surfaces, persistent job queue, worker lifecycle, processing state, scripts, and audit-log relationships. Captures current job statuses, retries, locking, backfill/rebuild/repair workflows, dashboards, metrics, source operations, and operator checklists. |
| [Capacity planning baselines](./capacity-planning.md) | runbook | current | Documents subsystem capacity assumptions, limits, observable signals, and scaling levers. Captures current throughput constraints, provider bottlenecks, cache/queue/storage limits, Redis adoption gate, and follow-up gaps. |
| [Incident response & SLO breach runbooks](./incident-response.md) | runbook | current | Documents incident response, SLO breach triage, mitigation, and post-incident review boundaries. Captures current detection signals, metric queries, subsystem runbooks, escalation, and recovery workflow. |
| [Performance tuning](./performance-tuning.md) | runbook | current | Performance tuning guide for database query timing, PostgreSQL slow-query logging, pg_stat_statements, pooling, and listing/feed benchmark runs. |
| [External provider lifecycle and health operations](./provider-operations.md) | runbook | current | Documents common lifecycle and health model for optional external providers. Captures current provider states, credential rotation, outage response, degradation, drift handling, and operator actions. |
| [Release management runbook & deployment preflight checklist](./release-management.md) | runbook | current | Documents release gates, migration workflow, deployment checks, rollback decision tree, and post-release monitoring. Captures current quality tiers, database target handling, build/dev caveats, smoke verification, and rollback process. |
| [Security event and audit-log operations](./security-audit.md) | runbook | current | Admin security surface: the in-memory security event buffer at /admin/security, the durable AuditLog read API, retention, and metadata-only, redacted investigation rules. |
| [TTS job scheduling, retry, and rebuild](./tts-jobs.md) | runbook | current | Documents Operations-owned TTS_GENERATE job scheduling and its boundary with Speech/Media. Captures current dedupe, retry, rebuild, worker, processing-step, and operator behavior for generated narration. |
| [WebStack VM deployment](./vm-deployment.md) | runbook | current | Deploys ReadWise to the WebStack VM through the pinned reusable GitHub Actions workflow, a minimal Alpine web image, a Compose worker service from a commit-matched worker image, a separate migration image, shared PostgreSQL, authenticated account email, and scheduled retention maintenance. |

<!-- END GENERATED: docs-index -->
