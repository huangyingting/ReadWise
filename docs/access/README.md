---
type: "index"
status: "current"
last_updated: "2026-11-19"
description: "Who may use ReadWise and with what authority: account admission and lifecycle, capability-based RBAC, organizations, memberships, classrooms, and tenant privacy."
---

# Access and tenancy

Identity, admission, capabilities, and tenant scope. Access provides the identity, capability, and scope context; resource subsystems apply it to their own data (ADR [0008](../architecture/0008-organization-ready-tenant-model.md), [0009](../architecture/0009-capability-based-authorization.md)).

Add a document here when the change affects who can sign up, sign in, hold a role or capability, or belong to an organization or classroom.

## Code ownership

- `src/lib/account-admission/`, `src/lib/account-lifecycle/`
- `src/lib/rbac.ts`, `src/lib/org/`, `src/lib/tenant-api.ts`
- `src/lib/classroom/` (membership, join codes, assignment access)
- `src/app/(app)/settings/`, `src/app/register/`, `src/app/invite/`, `src/app/api/admin/invitations/`

## Documents

<!-- BEGIN GENERATED: docs-index (npm run docs:index) -->

| Document | Type | Status | Description |
| --- | --- | --- | --- |
| [Account admission and authentication methods](./account-admission.md) | reference | current | Documents invitation-only and public account admission, password registration and recovery, encrypted GitHub Actions email queueing, explicit social-account linking, admin invitation operations, bootstrap, rate limits, and retention. |
| [Account lifecycle, exports, deletion, and support actions](./account-lifecycle.md) | design | current | Documents account ownership, support/admin action boundaries, export/delete cascades, and access-related data lifecycle contracts. Captures current account APIs, admin support workflows, guardrails, privacy constraints, and deletion/export behavior. |
| [Unified Design Specification: NextAuth + Invite-Only Account Admission Module](./invite-only-admission-spec.md) | design | accepted | Cross-repository NextAuth invite-only admission specification with ReadWise as the reference implementation: fail-closed admission, hashed single-use tokens, atomic claims, data model, flows, and an audit of sibling repositories. |
| [Multi-tenancy, classrooms, tenant-aware cache & analytics (Epic RW-E012)](./multi-tenancy.md) | design | current | Documents organization, membership, classroom, assignment, tenant-cache, and tenant-reporting boundaries. Captures current tenant roles, classroom ownership, assignment access, cache scoping, analytics privacy, and migration behavior. |
| [Capability-based access control](./rbac.md) | policy | current | Documents global, tenant, and classroom capability resolution boundaries. Captures current role-to-capability mappings, guard usage, denial behavior, and authorization testing expectations. |

<!-- END GENERATED: docs-index -->
