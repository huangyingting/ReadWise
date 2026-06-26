# Classroom Roster Import & Invitation Lifecycle

**Epic:** RW-E012 — Multi-tenancy & Classrooms  
**Issue:** #741  
**Status:** Design only — no code changes in this document.

---

## 1. Purpose

This document designs two capabilities on top of the existing classroom
foundation (RW-060 – RW-061):

1. **Roster import** — bulk-add students via CSV upload.
2. **Invitation lifecycle** — structured states for invite-link and email
   invitations from `PENDING` through `ACCEPTED`, `EXPIRED`, and `REVOKED`.

Everything here builds on the *current* model. Each section is marked
**[existing]** (no schema change needed) or **[new]** (schema addition
required).

---

## 2. Current Model (Existing)

All entities below exist today in `prisma/schema.prisma`.

### 2.1 Authorization axes [existing]

| Layer | Model | Role values |
|---|---|---|
| System | `User.role` | `Admin`, `Reader` |
| Tenant | `Membership.role` | `OrgAdmin`, `Teacher`, `Member`, `Student` |
| Classroom | `ClassroomMembership.role` | `Teacher`, `Student` |

A `Teacher` org membership grants `classroom.manage`,
`classroom.assignments.manage`, and `classroom.students.manage` via
`src/lib/rbac.ts`. An `OrgAdmin` inherits all three plus `org.manage` and
`org.members.manage`.

### 2.2 Classroom & roster models [existing]

```prisma
model Classroom {
  id        String
  orgId     String        // tenant boundary
  name      String
  teacherId String        // primary teacher (also a ClassroomMembership row)
  members   ClassroomMembership[]
  assignments Assignment[]
}

model ClassroomMembership {
  id          String
  classroomId String
  userId      String        // must be an existing User
  role        ClassroomRole // Teacher | Student
  createdAt   DateTime
  @@unique([classroomId, userId])
}
```

`addClassroomMember` uses an `upsert` on `@@unique([classroomId, userId])`, so
adding the same user twice just updates the role — it is already idempotent.
`removeClassroomMember` hard-deletes the row; there is no soft-delete or
`removedAt` today.

### 2.3 Current enrollment flow [existing]

```
Teacher → POST /api/classrooms/[id]/members  { userId, role? }
         → requireClassroomManageApi
         → addClassroomMember (upsert)
```

This works for one user at a time when the userId is already known. It does **not**
support:
- Users who have not yet registered.
- Bulk import.
- Async acceptance by the invitee.

---

## 3. Invitation Lifecycle

### 3.1 Invitation mechanisms [new]

| Mechanism | Description |
|---|---|
| **Email invite** | Teacher enters one or more email addresses; a `RosterInvitation` row is created per address. |
| **Invite link/code** | Teacher generates a shareable link containing a cryptographically random token bound to one classroom. Any user who opens the link may accept. |
| **CSV import** | Teacher uploads a CSV. Each row resolves to either an immediate enrollment (existing user, already a classroom member) or a `RosterInvitation` (unknown email or new-to-platform user). |

All three share the same `RosterInvitation` model and state machine.

### 3.2 States [new]

```
PENDING → ACCEPTED
        → EXPIRED   (TTL elapsed, background job)
        → REVOKED   (teacher/admin action)
```

| State | Meaning |
|---|---|
| `PENDING` | Invitation created; invitee has not yet acted. |
| `ACCEPTED` | Invitee accepted; a `ClassroomMembership` row was created in the same transaction. |
| `EXPIRED` | TTL window elapsed without acceptance. No membership was created. |
| `REVOKED` | Teacher or OrgAdmin cancelled the invitation before acceptance. No membership was created. |

There is intentionally **no** `DECLINED` state to avoid leaking whether a
specific email address belongs to a registered user.

### 3.3 Transitions [new]

| From | To | Trigger | Actor |
|---|---|---|---|
| — | `PENDING` | Invite created (CSV row / email form / link generation) | Teacher, OrgAdmin, system (CSV) |
| `PENDING` | `ACCEPTED` | Invitee clicks accept link while authenticated | Invitee |
| `PENDING` | `EXPIRED` | Background job: `expiresAt < now()` | System |
| `PENDING` | `REVOKED` | Teacher or OrgAdmin revokes via API | Teacher, OrgAdmin |
| `ACCEPTED` | — | Terminal; cannot transition | — |
| `EXPIRED` | `PENDING` | Teacher re-sends (creates a NEW row; old row stays EXPIRED) | Teacher, OrgAdmin |
| `REVOKED` | `PENDING` | Teacher re-invites (creates a NEW row) | Teacher, OrgAdmin |

A revoked or expired invitation is never mutated back to `PENDING`. Re-invite
creates a fresh row; this preserves the audit trail.

### 3.4 Proposed `RosterInvitation` model [new]

```prisma
/// Invitation lifecycle for classroom roster import and invite flows.
/// A row transitions PENDING → ACCEPTED | EXPIRED | REVOKED.
/// Accepted invitations create a ClassroomMembership row in a transaction.
/// NEVER log or persist token values outside this table.
model RosterInvitation {
  id          String               @id @default(cuid())
  classroomId String
  orgId       String               // denormalized for index & tenant scoping
  invitedById String               // userId of the teacher/admin who created it
  /// Null for invite-link invitations (any bearer may accept).
  /// Non-null for email invitations (only the matched user may accept).
  email       String?
  /// Null for email invitations. Non-null and URL-safe random string for invite
  /// links and CSV-generated tokens. Treat as a bearer credential: never log.
  token       String               @unique
  role        ClassroomRole        @default(Student)
  status      RosterInvitationStatus @default(PENDING)
  /// Null after acceptance: resolved user.
  acceptedById String?
  expiresAt   DateTime
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  classroom   Classroom @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  invitedBy   User      @relation("SentInvitations",    fields: [invitedById], references: [id], onDelete: Cascade)
  acceptedBy  User?     @relation("AcceptedInvitations", fields: [acceptedById], references: [id])

  @@index([classroomId, status])
  @@index([email, status])
  @@index([orgId, status])
  @@index([expiresAt, status])   // expiry job scan
}

enum RosterInvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}
```

**Privacy rules for this model:**
- `email` is only populated when the teacher explicitly targets an address.
  Invite-link rows carry `email = null`.
- `token` is a bearer credential. It must **never** appear in logs, audit
  metadata, analytics events, or query parameters outside the accept endpoint.
  Store only the raw token; do not re-derive it.
- `acceptedById` is set only in the ACCEPTED state and only to the session
  user's own id — never taken from a request body.
- Do not surface invitation rows in any listing visible to the student before
  acceptance; doing so would confirm whether a peer was invited.

---

## 4. CSV Roster Import

### 4.1 CSV column specification [new]

| Column | Required | Validation |
|---|---|---|
| `email` | Yes | RFC 5321 format; ≤ 254 chars; normalized to lower-case |
| `name` | No | ≤ 200 chars; used only as a display hint in pending invite records |
| `role` | No | `student` or `teacher`; defaults to `student` |

Lines with a blank `email` or an invalid address are rejected and returned in a
validation error list. The import continues for all valid rows (partial success
is acceptable).

### 4.2 Row resolution logic [new]

For each valid CSV row the import service runs this decision tree:

```
email (normalised)
  │
  ├─ Already a ClassroomMembership for this classroom?
  │     └─ YES → skip (idempotent); append to "already enrolled" report
  │
  ├─ Existing User with matching email?
  │     ├─ YES, has Membership in org?
  │     │     ├─ YES → addClassroomMember (immediate enroll); report "enrolled"
  │     │     └─ NO  → addMember(org, Member) + addClassroomMember; report "enrolled + org-joined"
  │     └─ NO  → createRosterInvitation(email, token, expiresAt); report "invited"
  │
  └─ (no match) → createRosterInvitation; report "invited"
```

The entire import runs inside a single Prisma interactive transaction for
atomicity. If the transaction fails, no rows are persisted and the teacher sees
the error.

> **Tenant boundary:** `orgId` on every `RosterInvitation` must equal the
> classroom's `orgId`. The import service asserts this before writing.

### 4.3 Duplicate and re-join handling [new]

| Scenario | Behaviour |
|---|---|
| Row email already a classroom member | Skip; no error; reported as "already enrolled". |
| Row email has an open PENDING invitation | Skip; report "invitation already pending". A teacher may revoke and re-import to reset the TTL. |
| Row email was previously removed (no membership, no PENDING invite) | Treated as a fresh enroll/invite. Removal leaves no ghost state. |
| Same email appears twice in the CSV | Deduplicate before processing; warn in the report. |

### 4.4 Import result report [new]

The import API returns a structured summary (never raw student data in logs):

```ts
type ImportReport = {
  enrolled:        number;  // immediate ClassroomMembership rows created
  invited:         number;  // RosterInvitation rows created
  alreadyEnrolled: number;  // skipped (already a member)
  alreadyPending:  number;  // skipped (open invitation exists)
  invalid:         { row: number; reason: string }[];  // validation failures
};
```

---

## 5. Authorization

### 5.1 Who may invite or import [existing + new]

| Actor | Condition | Allowed actions |
|---|---|---|
| System admin (`Admin` global role) | always | All classroom ops across any org |
| OrgAdmin (`org.manage` capability) | member of the classroom's org | Create/revoke invitations, CSV import, remove members |
| Teacher (`classroom.manage` capability) | `teacherId` of the classroom OR Teacher `ClassroomMembership` | Create/revoke invitations, CSV import, remove members from OWN classroom only |
| Member / Student | any org membership | Accept an invitation addressed to them or via link |

The guard chain for mutating invitations mirrors `requireClassroomManageApi`:

1. `requireClassroomManageApi(session, classroomId)` — existing guard.
2. Assert `classroom.orgId === body.orgId` for CSV import routes.

No new guard primitives are needed; the existing `canManageClassroom` function
covers all invitation-write paths.

### 5.2 Accepting an invitation [new]

```
Student → GET /api/invitations/[token]/accept
        → requireSession  (must be authenticated)
        → load RosterInvitation by token
        → assert status === PENDING && expiresAt > now()
        → if email ≠ null: assert session.user.email === invitation.email
        → transaction:
            addMember(org, Student) if not already a member
            addClassroomMember(classroomId, userId, role)
            update invitation: status=ACCEPTED, acceptedById=session.user.id
        → redirect to /assignments
```

The token is a path segment (not a query param) to prevent it appearing in
`Referer` headers sent to third-party resources on the assignments page.

### 5.3 Tenant scoping [existing + new]

All invitation writes and reads must filter on `orgId` (the classroom's org)
*and* `classroomId` to prevent cross-tenant IDOR:

```ts
// Safe: always include orgId in WHERE when listing invitations
prisma.rosterInvitation.findMany({
  where: { classroomId, orgId: classroom.orgId, status: "PENDING" },
});
```

---

## 6. Privacy & Audit Rules

| Rule | Rationale |
|---|---|
| Never log `token` | Tokens are bearer credentials; logging them would allow log-access→classroom-join attacks. |
| Never include `email` of unaccepted invitations in student-visible APIs | Prevents enumeration of who else was invited. |
| `acceptedById` is set from `session.user.id` only | The accepting user's identity comes from the server session, not the request body, to prevent IDOR. |
| Invitation listing in teacher UI: omit `token`, show `email` only to the inviting teacher or an OrgAdmin of the same org | Scoped visibility. |
| Import CSV is never persisted server-side | Parse in memory, write only the result rows. Multipart files must not be written to disk or stored in object storage without explicit retention design. |
| Audit log events for invite create/revoke/accept | Use existing `AuditLog` pattern (plain-string `orgId` reference; no article text, no tokens). |

---

## 7. Data Model Summary

### 7.1 New enum [new]

```prisma
enum RosterInvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}
```

### 7.2 New model [new]

`RosterInvitation` — see §3.4 for full definition.

### 7.3 No changes to existing models [existing]

`Classroom`, `ClassroomMembership`, `Membership`, `Organization`, and
`Assignment` are **unchanged**. The roster import immediately creates
`ClassroomMembership` rows for resolved users, exactly as the existing
`addClassroomMember` command does.

---

## 8. New API Routes (Proposed)

| Method + path | Guard | Body / params |
|---|---|---|
| `POST /api/classrooms/[id]/invitations` | `canManageClassroom` | `{ email?, role?, expiresInDays? }` → single email invite or link generation |
| `POST /api/classrooms/[id]/invitations/import` | `canManageClassroom` | multipart CSV file → returns `ImportReport` |
| `GET /api/classrooms/[id]/invitations` | `canManageClassroom` | — → list PENDING invitations (no token in response) |
| `DELETE /api/classrooms/[id]/invitations/[invId]` | `canManageClassroom` | — → revoke (set REVOKED) |
| `POST /api/invitations/[token]/accept` | any session | — → accept and enroll |

All write routes go through `createHandler` + `requireClassroomManageApi` per
the existing pattern in `src/lib/tenant-api.ts`.

---

## 9. Command & Query API (Proposed)

These live in `src/lib/classroom/invitations.ts` (new file), following the
existing module pattern.

```ts
// Commands
createInvitation(input: CreateInvitationInput): Promise<RosterInvitation>
revokeInvitation(invitationId: string, classroomId: string): Promise<DomainResult>
acceptInvitation(token: string, userId: string): Promise<DomainResult<{ classroomId: string }>>
expireStaleInvitations(): Promise<number>   // called by background job

// Queries
listPendingInvitations(classroomId: string): Promise<InvitationRow[]>
getInvitationByToken(token: string): Promise<RosterInvitation | null>

// CSV import (returns ImportReport)
importRosterFromCsv(classroomId: string, csvText: string): Promise<ImportReport>
```

`DomainResult` is the existing `{ ok, error?, status? }` type from
`src/lib/result.ts` — no new abstraction needed.

---

## 10. Phased Implementation Plan

### Phase 1 — Data model & invitation commands (foundational)

1. Add `RosterInvitationStatus` enum and `RosterInvitation` model to both
   `prisma/schema.prisma` and `prisma/postgresql/schema.prisma`.
2. Generate and apply migration.
3. Implement `src/lib/classroom/invitations.ts`:
   - `createInvitation` (single email or link-mode with `email: null`).
   - `revokeInvitation`.
   - `acceptInvitation` (transaction: org membership + classroom membership +
     invitation status update).
   - `listPendingInvitations` (teacher-facing; no token in projection).
   - `getInvitationByToken` (accept flow only; token never re-exposed).
4. Add to `src/lib/classroom/index.ts` barrel.
5. Unit tests: state transitions, IDOR guards (wrong org, wrong user), expiry.

### Phase 2 — API routes

1. `POST /api/classrooms/[id]/invitations` — create invite (email or link).
2. `GET /api/classrooms/[id]/invitations` — list pending.
3. `DELETE /api/classrooms/[id]/invitations/[invId]` — revoke.
4. `POST /api/invitations/[token]/accept` — accept (session-bound).
5. Route integration tests covering IDOR and membership boundary cases.

### Phase 3 — CSV import

1. Implement `importRosterFromCsv` in `src/lib/classroom/invitations.ts`.
2. `POST /api/classrooms/[id]/invitations/import` — multipart CSV upload.
3. Parse, validate, and run the row-resolution decision tree (§4.2).
4. Return `ImportReport`; do not persist raw CSV.
5. Tests: duplicate rows, unknown emails, invalid addresses, partial success.

### Phase 4 — Expiry job & delivery placeholder

1. Add `expireStaleInvitations()` — sweeps `PENDING` rows past `expiresAt`.
2. Wire to an existing background job (e.g. `JobType.ARTICLE_INGEST` pipeline
   pattern) or a `/api/cron/expire-invitations` route guarded by a secret
   header (until a Messaging subsystem lands).
3. Invitation delivery: log the accept URL server-side at `info` level (no
   PII, token goes to structured log field `inviteToken` under `[REDACTED]`
   in default formatters). Real email delivery is **out of scope** until the
   Messaging subsystem issue lands.

### Phase 5 — Teacher UI

1. Roster tab on `/teacher/classrooms/[id]`: pending invitation list + revoke.
2. "Add students" form: email input + CSV upload button.
3. Accept flow: `/invitations/[token]` page (requires sign-in, then auto-accept
   + redirect).

---

## 11. Out of Scope (this issue)

- External LMS/SIS integration (Canvas, Google Classroom, Clever).
- Transactional email provider — deferred to a separate Messaging issue.
- Broad role migration beyond `MembershipRole` / `ClassroomRole`.
- Invite expiry UI (phase 4; background job required first).

---

## 12. Open Questions

| # | Question | Default assumption |
|---|---|---|
| 1 | Default invitation TTL? | 7 days for email invites; 30 days for link invites. Configurable per org via `Organization.settings`. |
| 2 | Can a Teacher invite another Teacher via CSV? | Yes — `role` CSV column accepts `teacher`; the guard still requires the importer to hold `classroom.manage`. |
| 3 | Should expired invitations be purged or retained for audit? | Retain with `EXPIRED` status for 90 days, then a separate cleanup job. |
| 4 | Maximum CSV rows per import? | 500 rows per request; return `413` if exceeded. |
| 5 | Should invite links be single-use or multi-use? | Multi-use (class-code style) until a use-case for single-use arises. Each acceptance creates one `ClassroomMembership` per user; the link is reusable. |
