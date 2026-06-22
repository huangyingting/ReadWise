# ADR-0008: Organization-ready tenant model

- **Status:** Proposed
- **Date:** 2026-06-22
- **Related:** #318 (RW-060), #319 (RW-061), #324 (RW-066)

## Context

ReadWise is single-user-account oriented today, but planned classrooms and organizations need shared administration, assignments, content visibility, and audit boundaries. Tenant choices will affect authorization, data models, analytics, and storage keys.

## Decision

Introduce an organization and membership model before classroom-specific features. User-owned content remains valid, while organization-scoped content and assignments must carry organization context. Tenant-aware services should accept explicit user and organization context rather than reading global state.

## Alternatives considered

- **Add classroom tables without organizations:** Faster for one feature, but hard to generalize.
- **Make every row tenant-scoped immediately:** Strong isolation, but too disruptive before tenant use cases settle.
- **Separate database per tenant:** Operationally heavy for the current scale.

## Consequences

- Future classroom features have a stable ownership boundary.
- Queries and audit logs must distinguish personal and organization-scoped actions.
- Tenant isolation rules should be covered before broad organization rollout.

## Follow-up work

- [ ] #318: add organization and membership model.
- [ ] #319: build classroom assignments on top of memberships.
