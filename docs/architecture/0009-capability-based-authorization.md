# ADR-0009: Capability-based authorization layer

- **Status:** Accepted
- **Date:** 2026-06-23
- **Related:** #269 (RW-011), #247 (RW-E002), #318 (RW-060, tenant model)

## Context

ReadWise authorizes with a two-value `Role` enum (`Admin`, `Reader`) and
hard-coded `role === "Admin"` checks scattered across pages and routes. The
roadmap adds moderators, content editors, support agents, and tenant-level roles
(teachers, organization admins, classroom instructors). Hard-coded role checks do
not scale to that, but changing the `Role` enum now would risk the working app
before the role set is settled. We need an extensible permission model that keeps
existing Admin/Reader behavior byte-for-byte identical until a deliberate
migration.

## Decision

Introduce a **capability layer in code** (`src/lib/rbac.ts`) and gate features on
named capabilities (e.g. `articles.manage`) instead of roles. The module defines
the capabilities, the full near-term + future role set (active, planned system,
and tenant roles), and a role → capability mapping. `hasCapability(principal,
capability)` is the single runtime check; `requireCapability` (pages) and
`requireCapabilityApi` (routes) wrap it. Top-level admin access uses the
`admin.access` capability directly. **No Prisma migration** ships: the `Role` enum stays
`{ Admin, Reader }`, capabilities live in code, and the DB-backed migration path
is documented (`docs/access/rbac.md`). A compile-time guard keeps `ACTIVE_ROLES` in sync
with the Prisma enum.

## Alternatives considered

- **Add roles to the `Role` enum now:** Premature; the future role set is not
  settled and a breaking enum/migration would risk the working app.
- **Full DB-backed Role/Capability/RoleCapability tables now:** Overengineered
  for a two-role app; adds schema, queries, and admin UI before they are needed.
- **Keep hard-coded `role === "Admin"` checks:** Does not support new roles
  without touching every gate; exactly the problem to be solved.

## Consequences

- Positive: new admin features are gated by named capabilities; adding a role is
  a one-line mapping change; existing behavior is provably preserved (tests).
- Trade-off: capabilities are static in code until a future migration; per-user
  custom grants are not possible yet.
- Risk: the in-code map and the Prisma enum could drift — mitigated by the
  compile-time guard and `docs/access/rbac.md`.

## Follow-up work

- [ ] Promote a planned system role to the enum + `ACTIVE_ROLES` when first
      needed (e.g. Moderator).
- [x] Store tenant roles on the organization/classroom membership model (#318),
      separate from `User.role`.
