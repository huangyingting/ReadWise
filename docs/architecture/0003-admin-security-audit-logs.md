---
title: "ADR-0003: Append-only admin and security audit logs"
category: "Architecture"
architecture: "Architecture decision record for durable admin/security audit logging."
design: "Captures append-only audit-log decision, non-FK identifiers, metadata limits, and consequences."
plan: "Supersede with a new ADR if audit architecture changes; keep security/operations docs current for runtime behavior."
updated: "2026-07-01"
rename: "none"
---

# ADR-0003: Append-only admin and security audit logs

- **Status:** Accepted
- **Date:** 2026-06-22
- **Related:** #270 (RW-012), #324 (RW-066)

## Context

Admin actions already affect articles, tags, members, and generated content. As private content and roles expand, ReadWise needs a durable answer to who changed security-sensitive data and when.

## Decision

Add append-only audit log records for admin and security-sensitive actions. Store actor, action, target type/id, request id, timestamp, and safe metadata. Do not store secrets or full private article bodies in audit metadata.

Audit writes for high-risk mutations are part of the same database transaction as the mutation where the code path uses Prisma. If the audit write fails, the sensitive mutation rolls back or is not performed. Reading the admin audit-log API is itself audited with `admin.audit_logs.read` before entries are returned; audit persistence failure prevents disclosure of the audit log response.

## Alternatives considered

- **Rely only on structured application logs:** Useful for debugging, but retention and querying are operationally fragile.
- **Audit every low-level database mutation:** Too noisy and expensive for the current product stage.
- **Use an external audit service immediately:** Premature until event shape stabilizes.

## Consequences

- Admin investigations can use database-backed audit records.
- Write paths for privileged actions must emit audit events transactionally where practical.
- Metadata schemas need discipline to avoid leaking private content.

## Follow-up work

- [x] #270: implement admin/security audit log model and instrumentation.
