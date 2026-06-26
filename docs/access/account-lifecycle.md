# Account lifecycle, exports, deletion, and support actions

This document covers user-owned data export, self-service account deletion,
admin member mutations, and operator support actions. It complements
[`rbac.md`](./rbac.md) and [`../operations/admin-operations.md`](../operations/admin-operations.md):
authorization decides who may invoke an action, while this document describes
what the action is allowed to change.

## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Self-service commands | `src/lib/account-lifecycle/account-commands.ts` | Export the current user's data and delete their own account. |
| Admin member mutations | `src/lib/account-lifecycle/member-commands.ts` | Update global role and delete a member. |
| Support actions | `src/lib/account-lifecycle/support-commands.ts` | Revoke sessions, export member data, re-enqueue repair work, and record sign-in-help intent. |
| Read models | `src/lib/account-lifecycle/member-list.ts`, `src/lib/account-lifecycle/member-detail.ts` | Admin/member detail data with no mutation side effects. |
| API surfaces | `src/app/api/account/**`, `src/app/api/admin/members/**` | Route-layer auth, validation, request/audit context, and responses. |

## Export contract

`exportUserData(userId, audit?)` returns a JSON bundle of data owned by that
user: profile, saved words, progress, daily activity, reading lists, highlights,
tutor messages, quiz attempts, pronunciation attempts, reminder preferences
(711-A), level history, word mastery, article mastery, skill mastery, difficulty
feedback (711-C), org memberships, classroom memberships, and assignment
completions (711-E).

Non-negotiable boundaries:

- OAuth token material is never exported. Linked providers expose only provider
  name/type; `access_token`, `refresh_token`, `id_token`, scopes, and provider
  account ids are intentionally omitted.
- Article text is not duplicated into the export through progress/list rows;
  rows identify associated article ids and user-created metadata.
- When an audit context is supplied, the export and audit record run in the same
  transaction so the operator-visible action and exported snapshot correlate.

## Deletion contract

Self-service deletion (`deleteOwnAccount`) and admin deletion (`deleteMember`)
both delete the `User` row and rely on schema cascades for user-owned rows.

Important invariants:

- **Last-admin guard is transactional.** Before deleting or demoting an `Admin`,
  the command re-counts admins inside the transaction. Two concurrent actions
  cannot both pass the guard and leave ReadWise adminless.
- **Private imports are deleted with the owner.** `Article.owner` uses
  `onDelete: Cascade`; private imported articles cannot survive as ownerless
  public rows.
- **User-owned rows cascade.** Sessions, accounts, profile, reading progress,
  saved words, daily activity, reading lists/items, highlights, tutor messages,
  quiz attempts, pronunciation attempts, membership rows, and related learning
  rows are removed by Prisma/database relations.
- **Object-storage bytes purged on deletion (711-D).** Before deleting the user,
  `deleteOwnAccount` and `deleteMember` query `MediaAsset.storageKey` for all
  private articles owned by that user, then call `storage.delete()` for each key
  after the DB transaction commits. This is best-effort (`Promise.allSettled`);
  a storage-backend failure does not abort the account deletion.
- **Ledgers are intentionally non-cascading.** Audit logs, product analytics,
  AI invocation rows, and jobs store plain ids for investigation/reporting. Use
  the explicit retention/erasure helpers documented in
  [`../analytics/product-analytics.md`](../analytics/product-analytics.md) when a data-erasure
  workflow must remove analytics rows too.

Deletion returns structured domain results (`ok`, `error`, `status`) so route
handlers can return precise 404/409 responses without throwing for expected
guard failures.

## Role and member mutations

`updateMemberRole(id, role, audit?)` changes `User.role` only when the target
exists and the transition does not demote the last admin. No-op role updates skip
the database write but still audit when the caller supplies an audit factory.

`deleteMember(id, audit?)` returns the deleted user's role and owned private
article count. It performs the same last-admin guard and writes the audit record
inside the delete transaction.

Tenant roles are not stored in `User.role`; organization/classroom membership
roles are governed separately in [`multi-tenancy.md`](./multi-tenancy.md).

## Support actions

Support commands are explicit and audited:

| Command | Behavior | Secret handling |
| --- | --- | --- |
| `revokeMemberSessions` | Deletes all `Session` rows for the user, signing them out everywhere. | Does not return session tokens. |
| `exportMemberData` | Reuses `exportUserData` for a support/data-subject export. | Same token exclusions as self-service export. |
| `triggerMemberRepair` | Re-enqueues missing enrichment for the member's imported articles via `runBackfill(..., mode: "missing")`. | Does not clear study/progress data. |
| `resendSignInHelp` | Audited stub until transactional email is configured. | Never exposes magic links or tokens. |

Support tooling is for operator assistance, not for bypassing user data rules.
Every route must still enforce `support.assist` / `members.manage` capability and
must source the acting operator from the session.

## Operational checks

- Verify destructive account/member actions appear in `AuditLog` with request id,
  target id, actor id/role, and sanitized metadata.
- Confirm the last-admin guard by testing both self-delete and admin member
  delete/demote paths.
- For privacy requests, pair account deletion with product-analytics erasure if
  policy requires removing non-FK analytics rows.
- Keep export shape additions aligned with new user-owned Prisma relations.

## Tests

Relevant coverage lives in `tests/account.test.ts`, `tests/admin-members.test.ts`,
`tests/admin-member-detail.test.ts`, `tests/auth-bootstrap.test.ts`, and route
tests for admin/member APIs.
