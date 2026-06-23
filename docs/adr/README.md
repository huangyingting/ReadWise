# Architecture Decision Records

This directory records durable architecture choices for ReadWise. ADRs are short, practical notes that explain the context, decision, trade-offs, and follow-up work for choices that future contributors may otherwise have to rediscover.

## Index

| ADR | Title | Status | Related issues |
| --- | --- | --- | --- |
| [0001](0001-postgresql-primary-database.md) | PostgreSQL as the primary durable database | Proposed | #259, #314 |
| [0002](0002-article-visibility-and-access-service.md) | Explicit article visibility with centralized access checks | Accepted | #260, #261, #266, #267 |
| [0003](0003-admin-security-audit-logs.md) | Append-only admin and security audit logs | Proposed | #270 |
| [0004](0004-shared-rate-limiting.md) | Shared server-side rate limiting | Proposed | #284 |
| [0005](0005-persistent-job-table-and-worker-locking.md) | Persistent job table before external queues | Proposed | #271, #272, #273, #274 |
| [0006](0006-ai-governance-ledger-and-budgets.md) | AI invocation ledger, prompt versions, and budgets | Proposed | #277, #278, #279, #280, #312 |
| [0007](0007-object-storage-for-media.md) | Object storage for generated and imported media | Proposed | #307 |
| [0008](0008-organization-ready-tenant-model.md) | Organization-ready tenant model | Proposed | #318, #319 |
| [0009](0009-capability-based-authorization.md) | Capability-based authorization layer | Accepted | #269, #247 |

Use [0000-template.md](0000-template.md) for new ADRs.
