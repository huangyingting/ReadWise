---
title: "ADR-0008: Organization-ready tenant model"
category: "Architecture"
architecture: "Architecture decision record for organization-ready tenancy, memberships, classrooms, and assignments."
design: "Captures additive tenant model, role separation, soft references, and migration consequences."
plan: "Supersede with a new ADR if tenancy architecture changes; update access/learning/analytics docs for behavior changes."
updated: "2026-07-01"
rename: "none"
---

# ADR-0008: Organization-ready tenant model

- **Status:** Accepted
- **Date:** 2026-06-22
- **Related:** #318 (RW-060), #319 (RW-061), #324 (RW-066)

## Context

ReadWise started as single-user-account oriented, but classrooms and organizations need shared administration, assignments, content visibility, and audit boundaries. Tenant choices affect authorization, data models, analytics, and storage keys.

## Decision

Introduce an organization and membership model before classroom-specific features. User-owned content remains valid, while organization-scoped content and assignments must carry organization context. Tenant-aware services should accept explicit user and organization context rather than reading global state.

## Alternatives considered

- **Add classroom tables without organizations:** Faster for one feature, but hard to generalize.
- **Make every row tenant-scoped immediately:** Strong isolation, but too disruptive before tenant use cases settle.
- **Separate database per tenant:** Operationally heavy for the current scale.

## Consequences

- Classroom features have a stable ownership boundary.
- Queries and audit logs must distinguish personal and organization-scoped actions.
- Tenant isolation rules should be covered before broad organization rollout.

## Follow-up work

- [x] #318: add organization and membership model.
- [x] #319: build classroom assignments on top of memberships.
