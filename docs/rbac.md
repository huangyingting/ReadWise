# Role-Based Access Control (RBAC) model

> Status: **Active** (capability layer shipped in RW-011, #269). Parent epic:
> RW-E002 (#247). See also ADR-0009 and ADR-0008 (tenant model).

ReadWise authorizes users with a **capability-based** model. Code gates on
fine-grained, named capabilities (e.g. `articles.manage`) instead of hard-coded
role checks (`role === "Admin"`). The single source of truth is
[`src/lib/rbac.ts`](../src/lib/rbac.ts) — a pure, dependency-free module that is
imported by server components, route handlers, and the CLI.

This is deliberately a **code-only** model for now: the database still stores
just the existing `Role` enum (`Admin`, `Reader`). The capability layer makes the
system extensible **without** a breaking schema change, and documents the
migration path to richer DB-backed roles and tenant roles.

---

## Why

`Admin` + `Reader` is enough for a personal product, but the roadmap needs
moderators, content editors, support agents, and tenant-level roles (teachers,
org admins, classroom instructors). Hard-coding `role === "Admin"` in every page
and route does not scale to that, and changing the `Role` enum prematurely would
risk the working app. The capability layer decouples *what a feature requires*
from *who is allowed*, so new roles only need a new entry in one mapping table.

## Capabilities

Capabilities are namespaced `"<domain>.<verb>"` strings exported as the
`CAPABILITIES` constant. Current set:

| Capability                       | Meaning                                            | Granted to today |
| -------------------------------- | -------------------------------------------------- | ---------------- |
| `admin.access`                   | Enter the `/admin` back-office (umbrella)          | Admin            |
| `articles.manage`                | Manage articles (create/edit/rebuild AI/delete)    | Admin            |
| `tags.manage`                    | Manage the global tag taxonomy                     | Admin            |
| `members.manage`                 | Change member roles / remove accounts              | Admin            |
| `jobs.manage`                    | Operate the processing queue (retry/cancel/backfill) | Admin          |
| `analytics.view`                 | View analytics dashboards                          | Admin            |
| `security.view`                  | View security & audit logs                         | Admin            |
| `content.moderate`               | Moderate user-visible content                      | Admin (future Moderator) |
| `support.assist`                 | Use support tooling                                | Admin (future SupportAgent) |
| `articles.read`                  | Read permitted articles                            | Reader, Admin    |
| `profile.manage`                 | Manage own profile/settings                        | Reader, Admin    |
| `study.manage`                   | Manage own study list / saved words / bookmarks    | Reader, Admin    |
| `progress.track`                 | Track own reading progress                         | Reader, Admin    |
| `org.manage`                     | Administer an organization/tenant                  | *(planned)*      |
| `org.members.manage`             | Manage organization members                        | *(planned)*      |
| `classroom.manage`               | Create/manage classrooms                           | *(planned)*      |
| `classroom.assignments.manage`   | Create/grade classroom assignments                 | *(planned)*      |
| `classroom.students.manage`      | Manage classroom rosters                           | *(planned)*      |

The tenant-level capabilities (`org.*`, `classroom.*`) are placeholders that are
defined but not yet attached to any runtime check.

## Roles

The model defines the full near-term + future role set. Only the **active**
roles exist in the Prisma `Role` enum today; everything else is documented in
code so the model is reviewable, but **no user can hold a planned role** until
the migration below lands.

### Active system roles (in the DB enum, assignable now)

- **`Admin`** — full system administrator. Holds every current admin capability
  plus all base reader capabilities. The first user to sign in is promoted to
  `Admin` via the `events.createUser` hook in `src/lib/auth.ts`.
- **`Reader`** — default authenticated user. Holds only base reader
  capabilities. No admin capabilities.

### System pseudo-principal

- **`System`** — a trusted, non-user principal for server/CLI automation (e.g.
  the article processing pipeline). It is never stored in the DB or assigned to a
  sign-in; it grants every capability. This mirrors the `"System"` role already
  used by [`src/lib/article-access.ts`](../src/lib/article-access.ts).

### Planned system roles (defined, not yet assignable)

- **`Moderator`** — `content.moderate`, `articles.manage`, `admin.access` + base.
- **`ContentEditor`** — `articles.manage`, `tags.manage`, `admin.access` + base.
- **`SupportAgent`** — `support.assist`, `analytics.view`, `admin.access` + base.

### Planned tenant-level roles (defined, not yet assignable)

Tenant roles are **separate** from global system roles by design — an
organization admin is not a ReadWise system admin (none of them grant
`admin.access`). They map onto the organization/classroom model from ADR-0008.

- **`OrgAdmin`** — `org.manage`, `org.members.manage`, `classroom.manage`,
  `classroom.assignments.manage`, `classroom.students.manage` + base.
- **`Teacher`** — `classroom.manage`, `classroom.assignments.manage`,
  `classroom.students.manage` + base.
- **`ClassroomInstructor`** — `classroom.assignments.manage`,
  `classroom.students.manage` + base.

## How code uses it

`hasCapability(principal, capability)` is the single runtime check. A principal
is anything with a `role` (typically `session.user`); anonymous / unknown /
malformed roles are **denied by default**.

Guard helpers wrap it for the two enforcement surfaces:

- **Pages (server components):** `requireCapability(capability, callbackUrl)`
  from `@/lib/session` — redirects unauthenticated users to `/signin` and
  authenticated users lacking the capability to `/forbidden`.
- **API routes:** `requireCapabilityApi(capability)` from `@/lib/api-auth` —
  returns `401` if unauthenticated, `403` if the capability is missing.

The legacy umbrella helpers still exist and are **reimplemented in terms of
capabilities** (`requireAdmin` → `requireCapability("admin.access")`,
`requireAdminApi` → `requireCapabilityApi("admin.access")`), so every existing
call site keeps working unchanged. The shared `createAdminHandler`
(`src/lib/api-handler.ts`) continues to enforce `admin.access`.

Admin section pages are gated on their specific capability — `/admin/articles`
on `articles.manage`, `/admin/tags` on `tags.manage`, `/admin/members` on
`members.manage`, `/admin/jobs` on `jobs.manage`, `/admin/analytics` on
`analytics.view`, `/admin/security` on `security.view` — while the `/admin`
layout/dashboard keep the `admin.access` umbrella.

### Behavior is preserved

Because `Admin` is granted every admin capability and `Reader` is granted none of
them, the capability checks return the **exact same answer** as the previous
`role === "Admin"` checks. RW-011 is a behavior-preserving refactor: no current
gating changed, and the full test suite (including all admin/auth route tests)
stays green.

## Schema decision: no migration

RW-011 intentionally ships **no Prisma migration**. The `Role` enum stays
`{ Admin, Reader }` in both `prisma/schema.prisma` and
`prisma/postgresql/schema.prisma`. Capabilities live entirely in code. This is
the conservative choice the issue asks for — it keeps the working app untouched
while making new features capability-gated.

A compile-time guard in `src/lib/rbac.ts` asserts that the model's `ActiveRole`
union stays identical to the Prisma `Role` enum, so the two cannot silently
drift.

## Migration path to DB-backed roles

When a planned role first needs to be assignable, follow this additive,
non-breaking path:

1. **Promote the role to the enum.** Add the new value(s) to `enum Role` in
   **both** `prisma/schema.prisma` and `prisma/postgresql/schema.prisma`, then
   add the role to `ACTIVE_ROLES` in `src/lib/rbac.ts`. The compile-time guard
   keeps the two in sync. The role's capability grant already exists in
   `ROLE_CAPABILITIES`, so no gating code changes.
2. **Wire assignment.** Extend member management (`/admin/members`,
   `updateMemberRole`) to offer the new role. No capability checks change.
3. **For tenant roles**, do **not** put them on the global `User.role`. Introduce
   the organization/membership model (ADR-0008) and store the tenant role on the
   membership join (e.g. `OrganizationMembership.role`, `ClassroomMembership.role`).
   Resolve a tenant principal's capabilities from the membership row and pass an
   explicit `{ userId, role, tenantId }` context to tenant-aware services
   (the article-access context already leaves room for `tenantId`/`orgId`).
   Keep system roles (`User.role`) and tenant roles separate — a user can be a
   `Reader` globally and a `Teacher` within a classroom simultaneously.
4. **Optional richer model later.** If per-user custom grants are ever needed,
   move to a `Role`/`Capability`/`RoleCapability` table set and have
   `capabilitiesForRole` read from the DB instead of the in-code map. The public
   `hasCapability` / `requireCapability*` API stays the same, so call sites do not
   change.

## Testing

`tests/rbac.test.ts` covers capability resolution for `Admin` vs `Reader`,
deny-by-default for anonymous/unknown roles, that all planned roles are defined,
that tenant roles are separate from system admin access, and that the real
`requireCapability*` / `requireAdmin*` guards behave identically to the previous
role checks (401/403/redirect).
