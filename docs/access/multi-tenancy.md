---
title: "Multi-tenancy, classrooms, tenant-aware cache & analytics (Epic RW-E012)"
category: "Access"
architecture: "Documents organization, membership, classroom, assignment, tenant-cache, and tenant-reporting boundaries."
design: "Captures current tenant roles, classroom ownership, assignment access, cache scoping, analytics privacy, and migration behavior."
plan: "Update when tenant schemas, classroom routes, assignment workflows, RBAC, cache keys, or tenant reporting rules change."
updated: "2026-07-01"
rename: "none"
---

# Multi-tenancy, classrooms, tenant-aware cache & analytics (Epic RW-E012)

This document describes the multi-tenancy foundation added by RW-060..063:
organizations & memberships, classroom assignments & teacher workflows,
tenant-aware cache keys, and tenant-aware analytics & privacy rules.

The guiding principle is **additive, nullable, opt-in**: every tenancy feature is
inert until a user actually joins an organization. An account with no membership
behaves EXACTLY like the pre-tenancy single-user experience — no global/public
listing, cache key, or analytics surface changes for them.

---

## 1. Tenancy model (RW-060)

### Entities

| Model | Purpose |
| --- | --- |
| `Organization` | The tenant boundary. `name`, unique `slug`, optional `settings` Json. |
| `Membership` | Joins a `User` to an `Organization` with a tenant `role`. `@@unique([userId, orgId])` — a user MAY belong to multiple orgs. Cascades with both. |
| `Classroom` | Belongs to an org; has one primary `teacherId`. |
| `ClassroomMembership` | Joins a `User` to a `Classroom` with a `ClassroomRole`. `@@unique([classroomId, userId])`. |
| `Assignment` | A `Classroom` ↔ `Article` reading assignment with optional `dueDate`/`instructions`. |
| `AssignmentCompletion` | A student's progress on an assignment (`status`, optional `quizScore`, `completedAt`). `@@unique([assignmentId, studentId])`. |

`AssignmentStatus` values are `ASSIGNED`, `IN_PROGRESS`, and `COMPLETED` (mapped
to `assigned`, `in_progress`, `completed` in the database). A completion row is
created/updated for the authenticated student only; student ids are never taken
from the request body.

### Roles — two independent axes

- **Global `Role`** (`Admin` | `Reader`) lives on `session.user.role`. A global
  `Admin` is a ReadWise *system* admin and is treated as a **super-user across
  every org** (defense-in-depth).
- **Tenant `MembershipRole`** (`OrgAdmin` | `Teacher` | `Member` | `Student`)
  lives on `Membership` rows. It does NOT change the global role: an `OrgAdmin`
  is not a system admin.
- **`ClassroomRole`** (`Teacher` | `Student`) lives on `ClassroomMembership`.

Tenant capabilities resolve through the SAME `@/lib/rbac` capability table as
global roles. `membershipCapabilities(role)` / `membershipHasCapability(role,
cap)` map a tenant role onto capabilities, so a `Teacher` membership yields
`classroom.manage`, an `OrgAdmin` yields `org.manage` + `org.members.manage` +
classroom caps, and `Member`/`Student` carry only the base reader capabilities.

### Ownership / tenant scoping

Resources that can become tenant-scoped carry a **nullable** owner column:

- `Article.organizationId String?` — `null` means **global/public** content
  (the default, unchanged). A non-null value scopes the article to one org.

`organizationId` is a **soft (non-FK) scalar**, mirroring the existing
`AnalyticsEvent`/`AuditLog` plain-string-reference convention. This is a
deliberate SQLite decision: adding a real relation column forces a table rebuild
that would disrupt the FTS5 triggers on `Article`. The PostgreSQL schema keeps it
as a plain indexed `TEXT` column too, so the two databases stay in lockstep.
Referential integrity for org ownership is enforced in application code.

> **Why null = public:** existing rows have `organizationId = NULL`, so every
> public listing and cache key behaves identically after the migration. Tenancy
> is purely opt-in.

### Helpers — `src/lib/org/`

- `createOrganization(input, creatorUserId)` — creates the org and seats the
  creator as its first `OrgAdmin`, in one transaction.
- `addMember` / `updateMemberRole` / `removeMember` — membership CRUD. Role
  changes and removals **refuse to drop the last `OrgAdmin`** (a tenant must
  always retain an administrator) and return a structured
  `{ ok: false, error, status: 409 }`.
- `listUserOrganizations` / `listOrgMembers` / `getMembership` — reads.
- `orgCapabilities` / `hasOrgCapability` / `isSystemAdmin` — capability checks.
- `requireOrgMembership` / `requireOrgCapability` / `requireOrgAdmin` — **page**
  guards (redirect to `/forbidden`). Their **API** twins live in
  `src/lib/tenant-api.ts` (`requireOrgCapabilityApi`,
  `requireClassroomManageApi`) and throw `ApiError` instead.

---

## 2. Classrooms, assignments & teacher workflows (RW-061)

### Authorization layers (`src/lib/classroom/`)

- A **system admin** manages any classroom.
- An **org admin** (`org.manage`) manages any classroom in their org.
- A classroom's **own teacher** (`teacherId`) manages that classroom.
- A **student** only receives assignments and reports their OWN completion.

`canCreateClassroom(viewer, membership)` requires `classroom.manage` in the org;
`canManageClassroom(viewer, classroom, membership)` gates roster/assignment edits
and full progress reads.

### Pages

| Route | Audience | What it shows |
| --- | --- | --- |
| `/teacher` | Teachers / org admins | Their classrooms + create-classroom (and create-org bootstrap) forms. |
| `/teacher/classrooms/[id]` | Teacher / org admin / system admin | Class KPIs, assignments, **role-scoped** student progress, assign-article + add-student forms. |
| `/assignments` | Students | Their assigned readings with their OWN completion status + "mark complete". |

The student completion API accepts `{ status?, quizScore? }`; when omitted,
status defaults to `COMPLETED`. Scores are clamped to 0-100 in the route/schema
layer.

All three are added to `middleware.ts` (`PROTECTED_PREFIXES` + `config.matcher`)
and gate server-side via `requireSession` plus the membership/role checks above.

### API routes (all via `createHandler` + `src/lib/tenant-api.ts` guards)

| Method + path | Guard | Body |
| --- | --- | --- |
| `POST /api/orgs` | any session | `{ name, slug? }` → creator becomes OrgAdmin |
| `POST /api/orgs/[id]/members` | `org.members.manage` | `{ userId, role }` |
| `POST /api/classrooms` | `classroom.manage` in org | `{ orgId, name }` |
| `POST /api/classrooms/[id]/members` | manage classroom | `{ userId, role? }` |
| `POST /api/classrooms/[id]/assignments` | manage classroom | `{ articleId, dueDate?, instructions? }` |
| `GET /api/classrooms/[id]/analytics` | teacher / org admin / system admin | — (role-scoped result) |
| `POST /api/assignments/[id]/completion` | enrolled student | `{ status?, quizScore? }` (studentId from session, never the body) |

---

## 3. Tenant-aware cache keys (RW-062)

`src/lib/cache.ts` defines three visibility scopes and a strict key contract that
prevents private/tenant content leaking through a shared cache key.

### Scopes & key rules

| Scope | Key parts | Tags | Use |
| --- | --- | --- | --- |
| `public` | **UNCHANGED** (`keyParts` verbatim) | `articles` / `tags` | Global, shareable feeds. |
| `user` | `keyParts + ["user:<userId>"]` | `user:<userId>` | Personalized, per-user, non-shareable feeds. |
| `org` | `keyParts + ["org:<orgId>"]` | `org`, `org:<orgId>` | Tenant-specific feeds, isolated per org. |

The pure builder `tenantCacheKeyParts(keyParts, scope, tenantId)` is the testable
core:

- `public` → returns `keyParts` **unchanged**, so existing public listings keep
  their EXACT current keys (zero behavior change).
- `user`/`org` → **appends** the scope-qualified tenant id, so a per-user or
  per-org feed can never collide with a public key OR with another tenant's key
  (two different orgs ⇒ two different key arrays).

### Helpers

- `createTenantCachedListing(fn, keyParts, scope, opts)` — tenant variant of
  `createCachedListing`. The wrapped fn MUST take the tenant id as its FIRST
  argument; that id is woven into both the cache key and the invalidation tags. A
  distinct `unstable_cache` instance is memoized per tenant so per-org
  invalidation is precise.
- `orgCacheTag(orgId)` / `userCacheTag(userId)` — tag builders.
- `revalidateOrgCache(orgId?)` — invalidates one org's feeds (precise) or, with
  no id, the umbrella `org` tag (all tenant feeds). Public feeds are untouched —
  invalidate those via `revalidateArticlesCache()`.

### Public listings stay public

`listPublishedArticles` / `listCategoryPage` / `listPicksPage` and the tag feeds
continue to use `createCachedListing` with their existing global keys. They only
ever read PUBLIC content (`publicListableArticleWhere` enforces `visibility =
PUBLIC`, `status = PUBLISHED`, `ownerId = null`), so an article with
`organizationId` set or non-public visibility is naturally excluded — there is no
shared key through which org/private content could leak. **New** org or
user-personalized feeds MUST use `createTenantCachedListing` (or include the
orgId/userId in their key parts) so the tenant dimension is part of the key.

---

## 4. Tenant-aware analytics & privacy (RW-063)

`src/lib/analytics/tenant.ts` is the single source of truth for who can see what,
class-level aggregation, and redaction.

### Visibility matrix

| Viewer | Scope | Individual learner rows? |
| --- | --- | --- |
| **Learner** | own data only (`self`) | own only |
| **Teacher** | their classroom (`classroom`) | **yes** — per-student (pedagogical need) |
| **Org admin** | their org (`org`) | **no** — AGGREGATES only |
| **System admin** | everything (`global`) | yes |

`analyticsAccessFor(role)` returns the `{ scope, individualData }` envelope;
`learnerDataAccess(req)` decides a single viewer↔learner request (deny-by-default
for any relationship the role doesn't cover).

`viewerRoleForClassroom` deliberately classifies an org admin who is NOT the
classroom's teacher as `orgAdmin` (aggregate-only) even though they can *manage*
the classroom — managing (write) and reading individual learner records are
separate concerns.

### Aggregation & redaction

- `aggregateClassroom(data)` is **pure**: it turns the raw progress matrix into
  class-, assignment- and student-level numbers. A missing completion row counts
  as "not started", so the denominator is always `studentCount × assignmentCount`.
- `redactIndividualData(analytics)` strips the named `perStudent` rows and sets
  `redacted: true`.
- `applyAnalyticsAccess(analytics, access)` redacts unless the role has
  `individualData`. The `/teacher/classrooms/[id]` page and the analytics API
  both run results through this envelope, so an org admin physically never
  receives named per-learner data.

### Data retention & export

- **Per-event** retention/erasure is owned by `@/lib/analytics`
  (`pruneOldEvents`, `deleteEventsForUser`) — unchanged by this epic.
- **Class analytics are DERIVED on read** from `AssignmentCompletion`. They store
  no separate snapshot, so erasing a learner (their rows cascade-delete with the
  `User`) removes them from every aggregate automatically — no extra cleanup
  path, and no stale analytics after a deletion/export request.
- **Export by role** follows the same envelope as on-screen visibility: a teacher
  may export their class (including per-student rows); an org admin may export
  org-level aggregates only (redacted); a learner may export only their own data;
  a system admin may export anything. Any future export endpoint MUST route
  through `applyAnalyticsAccess` / `learnerDataAccess` so it cannot leak
  out-of-scope individual data.

---

## 5. Acceptance mapping

- **RW-060** — `Organization`/`Membership` models, multi-org membership, nullable
  `organizationId` ownership, tenant roles wired into `rbac.ts`, `org.ts`
  helpers + guards, single-user experience preserved. → §1
- **RW-061** — `Classroom`/`ClassroomMembership`/`Assignment`/
  `AssignmentCompletion` models, `classroom.ts` helpers, teacher views + student
  view, lean API routes. → §2
- **RW-062** — tenant/visibility cache dimension, `ORG_CACHE_TAG` +
  `revalidateOrgCache`, `createTenantCachedListing`, public keys unchanged, no
  cross-tenant collisions. → §3
- **RW-063** — visibility rules, class-level aggregation, redaction of
  out-of-scope individual data, retention/export per role, class analytics
  surfaced in the teacher view. → §4
