---
title: "Capability-based access control"
category: "Access"
architecture: "Documents global, tenant, and classroom capability resolution boundaries."
design: "Captures current role-to-capability mappings, guard usage, denial behavior, and authorization testing expectations."
plan: "Update when roles, capabilities, route guards, tenant membership rules, or admin surfaces change."
updated: "2026-07-01"
rename: "none"
---

# Capability-based access control

ReadWise authorizes users with a capability-based model. Code gates on
fine-grained permissions such as `articles.manage` or `classroom.manage` instead
of scattering raw `role === "Admin"` checks across pages and APIs.

The source of truth is `src/lib/rbac.ts`. It is pure and dependency-free so it
can be imported from server components, route handlers, CLIs, and tests.

## Role axes

ReadWise now has two separate authorization axes:

| Axis | Storage | Purpose |
| --- | --- | --- |
| Global system role | `User.role` (`Admin`, `Reader`) | System-wide privileges and normal reader access. |
| Organization membership role | `Membership.role` (`OrgAdmin`, `Teacher`, `Member`, `Student`) | Tenant capabilities inside one organization. |
| Classroom membership role | `ClassroomMembership.role` (`Teacher`, `Student`) | Roster/assignment relationship inside one classroom. |

A tenant `OrgAdmin` is **not** a system `Admin`. A user may be globally a
`Reader` and still be a `Teacher` or `OrgAdmin` in a specific organization.
System `Admin` remains a super-user for defensive admin/tenant operations.

## Capabilities

Capabilities are string literals exported by `CAPABILITIES`.

| Capability | Meaning | Granted by default to |
| --- | --- | --- |
| `admin.access` | Enter the `/admin` back-office. | `Admin` |
| `articles.manage` | Manage articles and AI rebuild/delete flows. | `Admin`, planned `Moderator`, planned `ContentEditor` |
| `tags.manage` | Manage global tag taxonomy. | `Admin`, planned `ContentEditor` |
| `members.manage` | Manage global users and roles. | `Admin` |
| `jobs.manage` | Operate background queue and backfills. | `Admin` |
| `analytics.view` | View product/AI/admin analytics. | `Admin`, planned `SupportAgent` |
| `security.view` | View security and audit-log surfaces. | `Admin` |
| `content.moderate` | Review/takedown user-visible content. | `Admin`, planned `Moderator` |
| `sources.manage` | Sync/toggle content sources and inspect provider health. | `Admin` |
| `support.assist` | Use support tooling. | `Admin`, planned `SupportAgent` |
| `articles.read` | Read permitted articles. | `Reader`, `Admin`, membership roles |
| `profile.manage` | Manage own profile/settings. | `Reader`, `Admin`, membership roles |
| `study.manage` | Manage own study list/bookmarks/saved words. | `Reader`, `Admin`, membership roles |
| `progress.track` | Track own reading progress. | `Reader`, `Admin`, membership roles |
| `org.manage` | Administer an organization. | `OrgAdmin` membership |
| `org.members.manage` | Manage organization members. | `OrgAdmin` membership |
| `classroom.manage` | Create/manage classrooms. | `OrgAdmin`, `Teacher` membership/classroom role |
| `classroom.assignments.manage` | Create/grade classroom assignments. | `OrgAdmin`, `Teacher`, `ClassroomInstructor` planned role |
| `classroom.students.manage` | Manage classroom rosters/students. | `OrgAdmin`, `Teacher`, `ClassroomInstructor` planned role |

## Global roles

### Active DB-backed roles

`ACTIVE_ROLES` is intentionally identical to Prisma's `Role` enum:

- `Admin` — all admin capabilities plus all base reader capabilities.
- `Reader` — base reader capabilities only.

A compile-time guard in `src/lib/rbac.ts` ensures the in-code active roles and
Prisma enum cannot drift silently.

The first user to sign in is promoted to `Admin` by the `events.createUser` hook
in `src/lib/auth.ts`.

### System pseudo-principal

`System` is a trusted non-user principal for server/CLI automation, such as the
article processor. It is never stored in the database and grants all
capabilities.

### Planned system roles

These roles are **not yet assignable** (not in the Prisma `Role` enum) but their
capability grants already exist in `ROLE_CAPABILITIES` in `src/lib/rbac.ts`. The
role constants (`PLANNED_SYSTEM_ROLES`, `PLANNED_ROLES`) are **module-private**
in `rbac.ts` — they are intentional implementation details, not part of the
public API surface. Code should gate on capabilities, not on planned role names.

| Role | Rationale | Key capabilities |
| --- | --- | --- |
| `Moderator` | Future content-review role for high-volume moderation without full admin access. | `content.moderate`, `admin.access` (view only) |
| `ContentEditor` | Future role for editorial staff who create/edit articles but do not manage members or jobs. | `articles.manage`, `tags.manage`, `admin.access` |
| `SupportAgent` | Future support-tooling role for customer-success staff. | `support.assist`, `analytics.view`, `admin.access` |

Their capability grants already exist in `ROLE_CAPABILITIES` so migration can be
additive when product requirements need them.

## Tenant and classroom roles

Tenant roles are active today through `Membership` and `ClassroomMembership`.
They resolve capabilities through the same table as global roles.

### `Membership.role`

| Role | Capabilities |
| --- | --- |
| `OrgAdmin` | Base reader capabilities, `org.manage`, `org.members.manage`, `classroom.manage`, `classroom.assignments.manage`, `classroom.students.manage`. |
| `Teacher` | Base reader capabilities, `classroom.manage`, `classroom.assignments.manage`, `classroom.students.manage`. |
| `Member` | Base reader capabilities only. |
| `Student` | Base reader capabilities only. |

### `ClassroomMembership.role`

| Role | Meaning |
| --- | --- |
| `Teacher` | Can be used as a classroom-level teaching relationship; classroom management still checks the classroom's primary `teacherId`, org admin capability, or system admin status. |
| `Student` | Receives assignments and can report only their own completion. |

Helpers:

- `membershipCapabilities(role)` resolves capabilities for membership/classroom
  roles.
- `membershipHasCapability(role, capability)` performs tenant-role checks.
- `hasOrgCapability(membership, capability)` in `src/lib/org/guards.ts` wraps this for
  organization membership rows.
- `canCreateClassroom` and `canManageClassroom` in `src/lib/classroom/guards.ts` apply
  classroom rules.

## Enforcement helpers

### Guard layer (REF-044)

The auth guard modules form a layered hierarchy:

| Module | Role |
| --- | --- |
| `src/lib/rbac.ts` | Pure capability/role model — no I/O. |
| `src/lib/auth-core.ts` | Shared core: session loading (`loadSession`) and capability check (`sessionHasCapability`). No redirect or response side effects. |
| `src/lib/session.ts` | Page guards — redirect to `/signin` or `/forbidden` on failure. |
| `src/lib/api-auth.ts` | API guards — return `NextResponse` 401/403 on failure. |

**When a session is missing:**
- In a server-component page → redirect to `/signin` (page guards).
- In an API/route handler → return 401 (API guards).
- In a service utility → call `loadSession()` and handle `null` as needed.

### Pages

- `requireCapability(capability, callbackUrl)` — page guard for global
  capabilities. Use `CAPABILITIES.adminAccess` for the top-level admin shell.
- `requireOrgMembership(orgId, callbackUrl)` — page guard for tenant membership.
- `requireOrgCapability(orgId, capability, callbackUrl)` — page guard for tenant
  capabilities.
- `requireOrgAdmin(orgId, callbackUrl)` — page guard for `org.manage`.

Unauthenticated users redirect to `/signin`; authenticated users without access
redirect to `/forbidden`.

### APIs

- `loadSession()` in `src/lib/auth-core.ts` — bare session fetch (no side effects).
- `sessionHasCapability(session, capability)` in `src/lib/auth-core.ts` — inline capability check.
- `requireCapabilityApi(capability)` — route helper returning 401/403 responses.
- `createAdminHandler(...)` — shared wrapper for routes gated by
  `CAPABILITIES.adminAccess`.
- `createCapabilityHandler(capability, config, handler)` — shared API wrapper
  for capability-gated routes.
- `requireOrgCapabilityApi(session, orgId, capability)` — tenant route guard.
- `requireClassroomManageApi(session, classroomId)` — classroom route guard.

Most app routes should be built with `createHandler`, `createAdminHandler`,
`createCapabilityHandler`, or `createPublicHandler` from `src/lib/api-handler.ts`
so auth, validation, CSRF, logs, metrics, tracing, and errors stay centralized.

## Current admin gating

Admin UI sections use capabilities rather than raw role checks:

| Section | Capability |
| --- | --- |
| `/admin` layout/dashboard | `admin.access` |
| `/admin/articles` | `articles.manage` |
| `/admin/sources` | `sources.manage` |
| `/admin/tags` | `tags.manage` |
| `/admin/members` | `members.manage` |
| `/admin/jobs` | `jobs.manage` |
| `/admin/analytics` and `/admin/analytics/ai` | `analytics.view` |
| `/admin/security` | `security.view` |

Destructive/admin mutations are also audited and surfaced as security events by
the shared API handler.

## Migration path for planned global roles

When a planned system role becomes assignable:

1. Add it to `enum Role` in both Prisma schemas.
2. Add it to `ACTIVE_ROLES` in `src/lib/rbac.ts`.
3. Confirm `ROLE_CAPABILITIES` already grants the intended permissions.
4. Extend member-management UI/actions to assign the role.
5. Add tests for the new role's capability set and any UI affordances.

Tenant roles do **not** belong in `User.role`; keep them on membership rows.

## Tests

`tests/rbac.test.ts`, `tests/auth-core.test.ts`, tenant/classroom tests, admin
route tests, and API handler tests verify:

- Admin vs Reader behavior remains preserved.
- Unknown roles are denied by default.
- Planned roles are defined but not globally assignable.
- Tenant roles are separate from system admin access.
- Capability/page/API guards return the expected redirect, 401, or 403.
- `loadSession` returns null for missing/malformed sessions.
- `sessionHasCapability` correctly delegates to the capability model.
