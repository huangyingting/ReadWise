---
title: "Tenant reporting privacy boundaries"
category: "Analytics"
architecture: "Documents tenant/classroom reporting visibility boundaries and aggregate-vs-learner data ownership."
design: "Captures current teacher/admin visibility, retention/export expectations, and privacy rules for classroom analytics."
plan: "Update when tenant reporting, classroom analytics, RBAC, export/deletion behavior, or privacy classifications change."
updated: "2026-07-01"
rename: "none"
---

# Tenant reporting privacy boundaries

This document defines what classroom teachers and organization administrators may
see about individual learners versus aggregates, which domain owns each reporting
fact, and the retention and export rules that govern tenant-scoped reporting.

> **Relationship to other analytics docs**  
> [product-analytics.md](./product-analytics.md) — the metadata-only product
> event stream (owned by Analytics).  
> [domain-reporting.md](./domain-reporting.md) — domain-level read models and
> their ownership/retention rules.  
> [docs/access/multi-tenancy.md](../access/multi-tenancy.md) — the tenancy
> model (orgs, classrooms, memberships, roles).

---

## 1. Why tenant reporting needs explicit boundaries

Classroom and organization dashboards compose facts from multiple domains
(Learning, Access & Tenancy, AI, Operations). Without explicit ownership rules,
it is easy to:

- expose individual learner data to a viewer whose role should only receive
  aggregates (e.g., an org admin seeing named per-student rows);
- conflate the product analytics event stream (owned by Analytics, optimized for
  funnels) with domain-owned learner facts (computed on read from source tables);
- add school dashboards or org-level exports that silently widen the privacy
  surface.

This document is the authoritative statement of those boundaries before any
school dashboard or org-level export is added.

---

## 2. Domain ownership of reporting facts

Tenant dashboards compose data from several domains. Each domain owns its own
read model and is responsible for its privacy, retention, and export rules.
Analytics (the product event stream) does not own or intermediate these facts.

| Reporting fact | Owning domain | Module |
|---|---|---|
| Assignment completion, quiz scores, per-student progress | Access & Tenancy | `src/lib/analytics/tenant.ts` |
| Learner reading progress, vocabulary, streaks | Learning | `src/lib/analytics/learner.ts` |
| Platform-wide article library and member activity counts | Article Library / Admin | `src/lib/analytics/admin.ts` |
| AI feature cost, volume, latency, and fallback data | AI | `src/lib/ai-usage-summary.ts` |
| Content-processing job health (step timelines, failure rates) | Operations | `src/lib/processing/state.ts` |
| Product analytics funnel / activation / retention events | Analytics | `src/lib/analytics/queries/` |

Admin dashboards **compose** these read models but do not own the underlying fact
tables or retention rules of each domain.

---

## 3. Visibility matrix — who sees what

The enforced visibility rules live in `src/lib/analytics/tenant.ts`
(`analyticsAccessFor`, `learnerDataAccess`, `viewerRoleForClassroom`).

### 3.1 Analytics viewer roles

| Role | Assigned when |
|---|---|
| `systemAdmin` | `session.user.role` is the global system-admin role (`isSystemAdmin`) |
| `teacher` | Viewer is the `classroom.teacherId` for the requested classroom |
| `orgAdmin` | Viewer has `org.manage` capability via their `Membership` |
| `learner` | Default — any authenticated user not matched by the above |

### 3.2 Classroom analytics access matrix

| Role | Scope | Individual learner rows (`perStudent`) |
|---|---|---|
| `systemAdmin` | Global — any classroom | **Yes** — named rows with `name`, `email`, scores |
| `teacher` | Own classroom only | **Yes** — named rows (pedagogical necessity) |
| `orgAdmin` | Own org — all classrooms | **No** — `perStudent` is stripped; `redacted: true` |
| `learner` | Own data only (`/assignments`) | **No** — classroom analytics endpoint returns 403 |

Enforcement path:

1. `GET /api/classrooms/[id]/analytics` resolves `viewerRoleForClassroom` from
   session + classroom + org membership.
2. A request that is not from a teacher, org admin, or system admin receives
   **403 Forbidden** before any data is fetched.
3. `getClassroomAnalytics(classroomId, role)` calls `applyAnalyticsAccess`,
   which calls `redactIndividualData` for any role where `individualData` is
   `false`. This strips the `perStudent` array and sets `redacted: true`.
4. The `perAssignment` aggregate (counts and rates per article, no names) is
   always returned to authorized viewers regardless of role.

### 3.3 Fields present at each access level

| Field | `teacher` / `systemAdmin` | `orgAdmin` |
|---|---|---|
| `classroomId`, `classroomName` | ✓ | ✓ |
| `studentCount`, `assignmentCount` | ✓ | ✓ |
| `totalExpected`, `totalCompleted`, `completionRate` | ✓ | ✓ |
| `averageQuizScore` (classroom-level) | ✓ | ✓ |
| `perAssignment[]` (counts + rates per article) | ✓ | ✓ |
| `perStudent[].name`, `.email`, `.completionRate`, `.averageQuizScore` | ✓ | **Redacted** |
| `redacted` flag | `false` | `true` |

### 3.4 Learner self-access

Learners access their own assignment progress via the classroom membership and
assignments API (`/assignments`), not via the classroom analytics endpoint.
`getLearnerAnalytics(userId)` in `src/lib/analytics/learner.ts` is always
scoped to a single `userId` — it never returns cross-user data.

---

## 4. Aggregation and cohort thresholds

### 4.1 Currently enforced

All classroom aggregates (`completionRate`, `averageQuizScore`, `perAssignment`)
are computed over the full enrolled cohort for the classroom. The aggregation
functions (`aggregateClassroom`, `redactIndividualData`) in
`src/lib/analytics/tenant.ts` are **pure** — they take raw rows and return
numbers, with no network calls, so they can be unit-tested without a database.

### 4.2 Gap — no minimum-cohort (k-anonymity) threshold

> **⚠ Follow-up required (not yet enforced)**

There is currently no minimum-cohort check. An org admin viewing a classroom
with a very small enrollment (e.g., 1–2 students) receives aggregate metrics
(`completionRate`, `averageQuizScore`) that may, in practice, uniquely identify
an individual learner's performance even without named rows.

Recommended follow-up: add a `MIN_COHORT_SIZE` guard (suggested: **5 students**)
in `applyAnalyticsAccess` or `getClassroomAnalytics`. When `studentCount <
MIN_COHORT_SIZE` and the viewer is an org admin, suppress or blur
`perAssignment` score aggregates (or return them without quiz scores). Track as
a separate issue.

---

## 5. Cross-tenant isolation

Cross-tenant data leakage is prevented at two layers:

1. **Classroom lookup** — `getClassroom(id)` fetches the classroom by ID. The
   route verifies that the viewer's `session.user.id` matches `teacherId` OR
   that the viewer holds `org.manage` capability for `classroom.orgId`. A
   teacher from org A cannot request a classroom in org B; the check would fail
   the membership lookup.

2. **Aggregation scoping** — `aggregateClassroom` only processes completion rows
   for students whose `studentId` is in the classroom's own `students` set.
   Completions from other classrooms are never included.

---

## 6. Retention and deletion

### 6.1 Classroom analytics (domain read model)

Classroom analytics are **computed on read** from `AssignmentCompletion`; there
is no separate analytics table to retain or prune.

When a learner's account is deleted:

- `AssignmentCompletion` rows for that student **cascade-delete** with the user.
- Future calls to `getClassroomAnalytics` will not include the deleted student —
  their data is automatically excluded from all aggregates.

No explicit per-user erasure step is needed for classroom analytics beyond the
standard account-deletion cascade.

### 6.2 Product analytics event stream

The product event stream is not a learner-owned domain table; it uses plain
`userId` strings (not a foreign key). Retention is managed explicitly:

| Mechanism | Detail |
|---|---|
| Retention window | Events older than `ANALYTICS_RETENTION_DAYS` (default **400 days**) are prunable via `pruneOldEvents()` — run from a scheduled job or CLI |
| Per-user erasure | `deleteEventsForUser(userId)` removes all events for a user; call explicitly on GDPR/account deletion |
| Enablement gate | Ingestion is gated by `analyticsEnabled()` — off under `NODE_ENV=test` unless `ANALYTICS_ENABLED=1` |

See [product-analytics.md](./product-analytics.md#privacy--retention) for full
details.

### 6.3 AI usage ledger

`AiInvocation` rows are owned by the AI domain. They must never contain prompt
text, article content, or user-generated input. Retention rules are owned by the
AI subsystem, not by Analytics or Access & Tenancy.

---

## 7. Export rules

| Surface | Authorized roles | What is exported | Individual learner data |
|---|---|---|---|
| `/api/admin/analytics/export` | `analytics.view` (system admin) | Product event stream aggregates (CSV/JSON) | No — aggregated counts only |
| Classroom analytics API (`/api/classrooms/[id]/analytics`) | Teacher, org admin, system admin | JSON response as described in §3 | Teacher/system admin: yes; org admin: no |

> **⚠ Follow-up required**  
> There is no classroom-specific bulk export endpoint today. If one is added, it
> must enforce the same role-based redaction as the analytics API and must
> require explicit opt-in (e.g., teacher-initiated, scoped to own classroom
> only).

---

## 8. Privacy invariants — summary

| Invariant | Enforced by |
|---|---|
| Org admins never receive named per-student rows | `redactIndividualData` in `src/lib/analytics/tenant.ts` |
| Learners cannot query classroom analytics endpoints | 403 gate in `src/app/api/classrooms/[id]/analytics/route.ts` |
| Cross-classroom/org data never mixed in one response | Membership check + `aggregateClassroom` student-set filter |
| Deleted learners removed from future aggregates | Cascade-delete on `AssignmentCompletion` |
| Product events never contain PII or content | `sanitizeEventProperties` drops sensitive keys at write time |
| Product events survive user deletion unless explicitly purged | `deleteEventsForUser` called at account deletion |
| AI ledger rows never contain prompts or user content | AI subsystem invariant (enforced at write site) |

---

## 9. Open gaps and follow-up issues

| Gap | Risk | Suggested action |
|---|---|---|
| No minimum-cohort threshold for org-admin aggregate views | Small classrooms (1–2 students) may leak individual performance indirectly | Add `MIN_COHORT_SIZE = 5` guard; suppress quiz-score aggregates below threshold |
| No classroom bulk-export endpoint | If added ad hoc, could bypass role-based redaction | Any export must reuse `applyAnalyticsAccess` with the same role resolution |
| Learner visibility into own classroom aggregate (e.g., class average) | Learners currently get 403; no "how does my class compare?" surface | Decide scope before adding; must not expose other learners' identities |
| AI usage per org/classroom | AI dashboard is platform-wide; no per-tenant AI cost view | Requires explicit per-tenant ledger query, gated by `orgAdmin` role |
