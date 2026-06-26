# School-year archival and tenant data retention

**Epic:** #740 — Multi-tenancy & Classrooms  
**Issue:** #744  
**Status:** Design only — no code changes in this document.

> **Convention:** Each section is labelled **[existing]** when the behaviour
> already exists in the schema or application code, or **[new]** when a schema
> addition, new command, or policy decision is required. All cascade references
> are grounded in `prisma/schema.prisma` and `prisma/postgresql/schema.prisma`.

---

## 1. Why school-year lifecycle management is needed

Education deployments have lifecycle operations that extend beyond individual
account deletion. At the end of a school year an operator may need to:

- **Archive** a classroom so it is read-only but its history remains accessible
  for reports and transcript requests.
- **Roll over** a classroom into a new cohort: copy the assignment plan but start
  fresh rosters.
- **Purge** old cohort records after a regulatory retention window expires.
- **Export** learner progress before records are archived.

None of these operations are destructive account-deletion events. They require
first-class lifecycle states and scoped authorization separate from the existing
`removeMember` / `deleteAssignment` hard-delete paths.

---

## 2. Current deletion and cascade behaviour [existing]

The following cascade tree is authoritative as of `prisma/schema.prisma`. It is
reproduced here as the baseline that archival design must not conflict with.

```
Organization (no archive state today)
 ├── Membership          onDelete: Cascade (via org)  → deleted with org
 └── Classroom           onDelete: Cascade (via org)
      ├── ClassroomMembership  onDelete: Cascade (via classroom or user)
      ├── Assignment      onDelete: Cascade (via classroom)
      │    └── AssignmentCompletion  onDelete: Cascade (via assignment or student User)
      └── (Article link is a non-FK scalar; org articles survive classroom deletion)

User deletion cascades:
  Membership, ClassroomMembership, AssignmentCompletion (via studentId)
  Classroom itself via teacherId (onDelete: Cascade on teacher relation)
```

Key points:

- **No `deleteOrganization` command exists** in `src/lib/org/commands.ts`. Org
  deletion today would require direct DB access or a one-off migration.
- `removeClassroomMember` **hard-deletes** the `ClassroomMembership` row; there
  is no `removedAt` soft-delete today.
- `deleteAssignment` hard-deletes and cascades all `AssignmentCompletion` rows.
- `Article.organizationId` is a soft non-FK scalar; org articles survive org
  deletion (application-level guard only).
- Classroom analytics are **computed on read** from `AssignmentCompletion` — no
  separate analytics table exists. See
  [`../analytics/tenant-reporting-privacy.md`](../analytics/tenant-reporting-privacy.md).

---

## 3. Data classification for lifecycle purposes

| Entity | Classification | Contains learner PII? | Owned by |
|---|---|---|---|
| `Organization` | Operational | No | Tenant (org admin) |
| `Membership` | Personal | role + timestamps | User / Org |
| `Classroom` | Operational | Teacher identity (userId) | Org |
| `ClassroomMembership` | Personal | userId, role | User / Classroom |
| `Assignment` | Operational | `instructions` (teacher text) | Classroom |
| `AssignmentCompletion` | Personal | `quizScore`, `completedAt`, `status` | Student |

See [`../security/data-lifecycle-matrix.md`](../security/data-lifecycle-matrix.md)
§ Access / Tenancy rows for full classification detail.

---

## 4. Lifecycle state machine

### 4.1 Classroom states [new]

```
ACTIVE  ──archive──►  ARCHIVED  ──purge──►  (rows deleted)
   ▲                      │
   └─────restore──────────┘
```

| State | Meaning |
|---|---|
| `ACTIVE` | Normal operation. Teachers can edit roster, assign articles, students submit completions. |
| `ARCHIVED` | Read-only. No new roster or assignment changes. Progress data and rosters retained for reporting and transcript requests. Classroom appears in teacher/admin views under a separate "Past classrooms" section. |
| `PURGED` | All learner-linked rows deleted (see §5.2). Only the classroom header row (`Classroom`) is optionally retained as a tombstone, or it is deleted with a final cascade. |

State is stored in a new **[new]** `ClassroomStatus` enum and a `status` column
on `Classroom`:

```prisma
/// Lifecycle state of a classroom across school years.
/// ACTIVE is the default; ARCHIVED is the post-year read-only state;
/// transition to purged deletes learner records after the retention window.
enum ClassroomStatus {
  ACTIVE
  ARCHIVED
}

model Classroom {
  // ... existing fields ...
  status    ClassroomStatus @default(ACTIVE)   // [new]
  archivedAt DateTime?                         // [new]  null when ACTIVE
}
```

> **Schema gap (follow-up required):** A migration must add `status` and
> `archivedAt` to both `prisma/schema.prisma` and
> `prisma/postgresql/schema.prisma`. Both databases must stay in lockstep. Track
> as a separate implementation issue.

### 4.2 Organization states [new]

Organizations can also be archived when a tenant contract ends, but the
school-year archive cycle primarily operates at the classroom level. Org-level
archival is described separately in §4.3.

### 4.3 Org-level archival [new]

An organization archived at year-end (e.g., a one-cohort tenant) follows the
same read-only pattern:

```
ACTIVE  ──archive──►  ARCHIVED  ──purge──►  (cascade delete)
```

Proposed: store `archivedAt DateTime?` on `Organization`. A future `deleteOrganization`
command (see §6.1 gap) should assert the org is ARCHIVED before proceeding, to
prevent accidental destruction of live tenant data.

---

## 5. What is retained, archived, and deleted

### 5.1 At classroom archive (ACTIVE → ARCHIVED) [new]

| Entity | Action | Rationale |
|---|---|---|
| `Classroom` row | Retained — status set to ARCHIVED, `archivedAt` stamped | Tombstone for reporting |
| `ClassroomMembership` rows | Retained — read-only | Needed for transcript / completion attribution |
| `Assignment` rows | Retained — read-only | Needed to resolve completions to article titles |
| `AssignmentCompletion` rows | Retained — read-only | The primary learner-progress record |
| `RosterInvitation` rows (see #741) | All PENDING → EXPIRED on archive | No new enrolment in a read-only classroom |

No data is deleted during the archive transition. Archive is **non-destructive**.

### 5.2 At classroom purge (ARCHIVED → purged) [new]

Purge must be an **explicit, authorized, two-step action** (confirm prompt in
teacher UI or explicit CLI flag). It is irreversible.

| Entity | Action | Retention window before purge |
|---|---|---|
| `AssignmentCompletion` rows | **Deleted** (cascade from assignment or direct `deleteMany`) | Minimum **3 years** from `archivedAt` (see §6.1) |
| `ClassroomMembership` rows | **Deleted** | Same 3-year window |
| `Assignment` rows | **Deleted** (cascades completions) | Same |
| `Classroom` row | **Deleted** (tombstone removed) OR retained as empty shell | Operator choice |
| `Membership` (org-level) | **Not purged** — separate user/org lifecycle | — |

**Privacy rationale:** learner quiz scores and completion timestamps are personal
data. They must not be retained beyond the regulatory retention window without an
explicit legal basis. Three years aligns with common educational records
requirements; jurisdictions with longer requirements (e.g., 5 years in some EU
member states) should configure the `retentionYears` tenant setting (see §6.2).

### 5.3 At org deletion [existing + extended]

Existing behaviour: deleting an `Organization` row cascades to all `Membership`
and `Classroom` rows, which cascade to `ClassroomMembership`, `Assignment`, and
`AssignmentCompletion`.

Extended behaviour needed [new]:

- A `deleteOrganization` command must be implemented; currently it does not
  exist in `src/lib/org/commands.ts`.
- The command must assert `status === ARCHIVED` before executing the cascade to
  prevent accidental destruction of active tenant data.
- All classrooms within the org must themselves be ARCHIVED before the org can
  be deleted (or the command archives them in the same transaction).

### 5.4 Individual student removal mid-year [existing]

`removeClassroomMember` already hard-deletes the `ClassroomMembership` row.
`AssignmentCompletion` rows are **not** deleted — they are keyed on `studentId`,
which still exists as a `User`, so they survive the membership removal. This is
correct for mid-year changes (the student's work is preserved for reporting), but
it creates orphaned completion rows visible only to teachers/admins for that
classroom.

**Gap:** consider a `removedAt` soft-delete on `ClassroomMembership` to preserve
the audit trail that a student was once enrolled, without exposing them in active
roster views. Track as a follow-up issue.

---

## 6. Retention windows and configuration

### 6.1 Default retention windows [new]

| Record type | Default retention after archival | Basis |
|---|---|---|
| `AssignmentCompletion` | **3 years** from `Classroom.archivedAt` | Common educational records requirement |
| `ClassroomMembership` | **3 years** from `Classroom.archivedAt` | Same — needed for transcript attribution |
| `Assignment` | **3 years** from `Classroom.archivedAt` | Needed to resolve completions |
| `Classroom` tombstone | **3 years** from `Classroom.archivedAt`, then optional retention as metadata-only shell | Audit |
| `RosterInvitation` (EXPIRED/REVOKED) | **90 days** from status transition | Audit trail; see #741 §12 |
| Product analytics events | **400 days** (governed by `ANALYTICS_RETENTION_DAYS`) | Existing; see [`../analytics/tenant-reporting-privacy.md`](../analytics/tenant-reporting-privacy.md) §6.2 |

### 6.2 Tenant-configurable retention [new]

The `Organization.settings` JSON field (free-form metadata, already exists
[existing]) can carry a `retentionYears` key:

```json
{ "retentionYears": 5 }
```

The purge job reads this at execution time and applies it instead of the default
3-year window. This avoids a schema change while supporting jurisdictional
variation. If the key is absent, the default (3 years) applies.

**Invariant:** `retentionYears` must be ≥ 1. A setting of 0 must be rejected at
write time; immediate purge must always be an explicit authorized action.

---

## 7. Authorization

### 7.1 Who can archive and restore classrooms [new]

| Actor | Condition | Can archive | Can restore | Can purge |
|---|---|---|---|---|
| System admin (`Admin` global role) | Always | ✅ | ✅ | ✅ |
| OrgAdmin (`org.manage` capability) | Member of classroom's org | ✅ | ✅ | ✅ (after window) |
| Teacher (`classroom.manage` capability) | `teacherId` of the classroom OR Teacher `ClassroomMembership` | ✅ own only | ✅ own only | ❌ — purge requires OrgAdmin or system admin |
| Member / Student | Any org membership | ❌ | ❌ | ❌ |

**Rationale for purge restriction:** purge is an irreversible deletion of learner
personal data. Requiring OrgAdmin or system admin ensures a second accountable
actor beyond the classroom teacher. This aligns with the last-admin guard pattern
already enforced in `updateMemberRole` and `removeMember`
(`src/lib/org/commands.ts`).

### 7.2 Who can archive and delete organizations [new]

| Actor | Condition | Can archive org | Can delete org |
|---|---|---|---|
| System admin | Always | ✅ | ✅ (after all classrooms ARCHIVED) |
| OrgAdmin | Member of that org | ✅ | ❌ — org deletion requires system admin |
| Teacher / Member / Student | — | ❌ | ❌ |

Org deletion must remain a system-admin-only operation to prevent a compromised
or rogue OrgAdmin from destroying an entire tenant's data.

### 7.3 Guard chain for archive/purge endpoints [new]

Archive and purge commands extend the existing guard pattern:

```
POST /api/classrooms/[id]/archive
  → requireClassroomManageApi(session, classroomId)      // existing guard
  → assert classroom.status === ACTIVE
  → archiveClassroom(classroomId, actorId)               // new command

POST /api/classrooms/[id]/restore
  → requireClassroomManageApi(session, classroomId)
  → assert classroom.status === ARCHIVED
  → restoreClassroom(classroomId, actorId)               // new command

POST /api/classrooms/[id]/purge
  → requireOrgAdminApi(session, classroom.orgId)         // OrgAdmin+ only
  → assert classroom.status === ARCHIVED
  → assert archivedAt + retentionYears ≤ today           // retention window
  → purgeClassroomData(classroomId, actorId)             // new command
```

`requireClassroomManageApi` and `requireOrgAdminApi` follow the existing
API-guard pattern in `src/lib/tenant-api.ts`.

---

## 8. Privacy and cascade rules

### 8.1 Archive-first principle [new]

All lifecycle transitions follow an **archive-first** rule: no learner data is
deleted without first transitioning the classroom to ARCHIVED state. Direct
hard-delete of `AssignmentCompletion` rows outside the purge workflow is
prohibited.

### 8.2 Minimal retention [new]

After the retention window expires, the purge workflow deletes `AssignmentCompletion`
and `ClassroomMembership` rows. It does **not** delete `Assignment` rows that are
still referenced by completions in other classrooms (unlikely given the FK
design, but the purge must confirm the assignment's classroom matches before
deleting).

### 8.3 User account deletion interaction [existing]

If a student deletes their account while enrolled in an ARCHIVED classroom:

- `AssignmentCompletion` rows cascade-delete via `studentId` (existing behaviour,
  `onDelete: Cascade`).
- `ClassroomMembership` rows cascade-delete via `userId` (existing behaviour).
- Classroom analytics computed on subsequent reads will naturally exclude the
  deleted user — no explicit aggregate refresh is needed (see
  [`../analytics/tenant-reporting-privacy.md`](../analytics/tenant-reporting-privacy.md) §6.1).

This means **a student's individual data is already erasable at any time through
normal account deletion** — archival does not block GDPR/account-deletion rights.

### 8.4 Teacher deletion interaction [existing]

`Classroom.teacherId` carries `onDelete: Cascade`, so deleting the teacher's
`User` account **destroys the classroom**. This is a pre-existing behavior
documented in the data-lifecycle matrix. Archival does not change this cascade.

**Mitigation (follow-up):** Before a teacher account is deleted, system admins
should reassign `teacherId` to another teacher or archive the classroom first.
This should be documented in the account-lifecycle runbook. No schema change is
required; a pre-deletion check in the teacher-deletion UI is sufficient.

### 8.5 Never log learner progress data [existing]

Consistent with the existing invariant (see `docs/security/data-lifecycle-matrix.md`
§ Privacy column), `quizScore`, `completedAt`, assignment `instructions`, and
classroom membership lists must never appear in logs, audit metadata, analytics
events, or error messages during any archival or purge operation.

Audit log entries for archive/purge should record only:

```json
{ "action": "classroom.archive", "classroomId": "...", "orgId": "...", "actorId": "...", "at": "..." }
```

---

## 9. Export before purge [new]

Before a purge is permitted, the system should offer (and optionally require) an
export of classroom progress data.

| Export surface | Content | Authorized roles |
|---|---|---|
| Classroom progress export (CSV/JSON) | All `AssignmentCompletion` rows with student identifiers, assignment titles, quiz scores, completedAt | OrgAdmin, system admin |
| Student transcript export | Single student's completions across all classrooms in the org | OrgAdmin, system admin, learner (own data) |

**Privacy invariants apply during export:**
- Per-student rows (names, scores) are included only for OrgAdmin and system
  admin — consistent with the visibility matrix in
  [`../analytics/tenant-reporting-privacy.md`](../analytics/tenant-reporting-privacy.md) §3.2.
- Exports must never be cached server-side. Generate on demand, stream to
  requester.
- Export events are written to the audit log (classroomId, actorId, rowCount —
  never the actual content).

---

## 10. Schema gaps and follow-up issues

| Gap | Risk | Action required |
|---|---|---|
| No `ClassroomStatus` enum or `status`/`archivedAt` on `Classroom` | Cannot implement archive transitions | Create migration (both SQLite dev + PostgreSQL schemas) |
| No `archivedAt` on `Organization` | Cannot track org archive date for retention window | Add nullable `archivedAt DateTime?` to `Organization` |
| No `deleteOrganization` command | Org deletion requires direct DB or migration; risky | Implement in `src/lib/org/commands.ts` with ARCHIVED assertion |
| `removeClassroomMember` hard-deletes (`ClassroomMembership`) with no soft-delete | No audit trail for mid-year removals | Add `removedAt DateTime?` (soft-delete); update queries to exclude `removedAt IS NOT NULL` from active roster |
| No `purgeClassroomData` command | Purge requires direct DB; no authorization check | Implement in `src/lib/classroom/commands.ts` |
| No classroom progress export endpoint | Bulk export of completion records impossible | Add `/api/classrooms/[id]/export` behind OrgAdmin guard |
| No purge retention-window check | Purge could be triggered before window expires | Command must read `Organization.settings.retentionYears` and assert |
| Teacher deletion cascades the classroom | Live or archived classroom destroyed if teacher account deleted | Add pre-deletion guard / reassign teacherId workflow |

---

## 11. Phased implementation plan

### Phase 1 — Archive state (foundational schema)

1. Add `ClassroomStatus` enum, `status ClassroomStatus @default(ACTIVE)`, and
   `archivedAt DateTime?` to `Classroom` in both Prisma schemas.
2. Add `archivedAt DateTime?` to `Organization`.
3. Generate and apply migrations (dev + PostgreSQL).
4. Add `archiveClassroom(classroomId, actorId)` and
   `restoreClassroom(classroomId, actorId)` commands to
   `src/lib/classroom/commands.ts`. Commands:
   - assert current state before transitioning;
   - stamp `archivedAt`;
   - expire all PENDING `RosterInvitation` rows in the same transaction
     (depends on #741 `RosterInvitation` model landing first).
5. Unit tests: state transitions, guard on wrong state, auth boundary.

### Phase 2 — Archive read-only enforcement

1. Add `assertClassroomActive(classroomId)` guard called at the top of:
   `addClassroomMember`, `removeClassroomMember`, `assignArticle`,
   `deleteAssignment`, `recordAssignmentCompletion`.
2. API routes return `409 Conflict` with `{ error: "classroom.archived" }` when
   this guard fires.
3. Teacher UI renders ARCHIVED classrooms in a "Past classrooms" section (read-
   only banner, no roster/assignment controls).

### Phase 3 — Archive API routes

1. `POST /api/classrooms/[id]/archive` — requires `canManageClassroom`.
2. `POST /api/classrooms/[id]/restore` — requires `canManageClassroom`.
3. Route integration tests covering unauthorized and wrong-state cases.

### Phase 4 — Export

1. Implement `exportClassroomProgress(classroomId, format)` query in
   `src/lib/classroom/progress.ts`.
2. `GET /api/classrooms/[id]/export?format=csv|json` — requires OrgAdmin or
   system admin; streams result; no server-side caching.
3. Audit log entry on export.

### Phase 5 — Purge

1. Implement `purgeClassroomData(classroomId, actorId)` command:
   - Assert `status === ARCHIVED`.
   - Assert `archivedAt + retentionYears ≤ today`.
   - Delete `AssignmentCompletion` rows, then `ClassroomMembership` rows, then
     `Assignment` rows, then optionally the `Classroom` row — all in a
     transaction.
   - Write audit log entry.
2. `POST /api/classrooms/[id]/purge` — requires OrgAdmin or system admin.
3. Purge must be gated by a confirmation token (prevent accidental double-POST).

### Phase 6 — Org-level archival and deletion

1. Implement `archiveOrganization(orgId, actorId)` and
   `deleteOrganization(orgId, actorId)` in `src/lib/org/commands.ts`.
2. `deleteOrganization` asserts all classrooms are ARCHIVED (or archives them
   in the same transaction), then issues the cascade delete.
3. System-admin-only API route for org deletion.

### Phase 7 — Soft-delete mid-year removals (optional)

1. Add `removedAt DateTime?` to `ClassroomMembership`.
2. Update `removeClassroomMember` to set `removedAt` instead of hard-deleting.
3. Update roster queries to filter `removedAt IS NULL` for active views.
4. Provide a separate `purgeRemovedMemberships` job (sweeps rows past the
   retention window).

---

## 12. Out of scope (this issue)

- External SIS/LMS integration (Canvas, Google Classroom, Clever).
- Automatic year-end scheduling (cron triggering archive) — manual operator
  action for now.
- Bulk production data migration (existing classrooms are ACTIVE by default after
  the schema migration).
- Transactional email notification on archive/purge — deferred to the Messaging
  subsystem.
- Audit/security records: `AuditLog` rows are never auto-purged as part of the
  classroom lifecycle (separate retention policy).

---

## 13. Open questions

| # | Question | Default assumption |
|---|---|---|
| 1 | Should ARCHIVED classrooms be visible to students at all? | Yes — students can view their own completed assignments read-only via `/assignments`. |
| 2 | Can a teacher be removed from an ARCHIVED classroom? | Yes — OrgAdmin can change `teacherId`; this does not affect completion attribution. |
| 3 | Minimum cohort threshold for aggregate views post-archive? | Existing gap (≥5 students) documented in `tenant-reporting-privacy.md` §4.2 applies unchanged. |
| 4 | Should the purge require a separate approval workflow (two-admin confirm)? | Out of scope for this design; a confirmation token per §11 Phase 5 is the minimum bar. |
| 5 | What happens to `Article.organizationId` articles when an org is purged? | Articles survive org deletion today (soft scalar). Purge must explicitly null out `organizationId` on org articles or leave them as orphaned public content. Decision deferred. |
