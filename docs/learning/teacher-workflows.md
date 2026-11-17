---
type: "design"
status: "current"
last_updated: "2026-11-17"
description: "Documents learner/teacher assignment workflows built on Access-owned organizations, classrooms, memberships, and Assignment models. Teacher UI creates classrooms, manages rosters, assigns accessible articles, and views classroom analytics; student UI tracks assigned reading completion without changing Article Library access rules."
---

# Teacher workflows and assignments

Teacher workflows are the learner-facing education layer on top of the Access
subsystem's multi-tenant organization and classroom model. Access owns roles and
authorization; Learning owns the study/assignment experience and completion
signals.

## Teacher workflow

```mermaid
flowchart TD
    n0["Create classroom"] --> n1["Manage membership"]
    n1["Manage membership"] --> n2["Create assignment"]
    n2["Create assignment"] --> n3["Student reads and submits"]
    n3["Student reads and submits"] --> n4["Record completion"]
    n4["Record completion"] --> n5["View scoped analytics"]
```
## Code map

| Area | Code | Purpose |
| --- | --- | --- |
| Teacher landing | `src/app/(app)/teacher/page.tsx` | Teacher classroom overview. |
| Classroom detail | `src/app/(app)/teacher/classrooms/[id]/page.tsx` | Roster, assignments, analytics, and classroom actions. |
| Student assignments | `src/app/(app)/assignments/page.tsx` | Authenticated learner view of assigned readings. |
| Join a class | `src/app/(app)/join-class/page.tsx`, Settings → Classes | Learner class-code entry. |
| Classroom APIs | `/api/classrooms`, `/api/classrooms/[id]/members`, `/api/classrooms/[id]/join-code`, `/api/classrooms/join`, `/api/classrooms/[id]/assignments`, `/api/classrooms/[id]/analytics` | Create/manage classrooms, roster, assignments, analytics. |
| Assignment API | `/api/assignments/[id]/completion` | Student completion/quiz-score status update. |
| Access model | `Organization`, `Membership`, `Classroom`, `ClassroomMembership`, `Assignment`, `AssignmentCompletion` | Tenant/classroom data model in Prisma. |
| RBAC | `src/lib/rbac.ts`, `docs/access/rbac.md` | Tenant/classroom capability resolution. |
| Tests | `tests/classroom*.test.ts`, `tests/assignment*.test.ts`, `e2e/teacher-classroom.spec.ts` | Authorization, route, query, progress, and e2e coverage. |

## Role boundary

- `OrgAdmin` and `Teacher` are tenant roles, not global `Admin` roles.
- Teachers manage their classrooms and assignments within their organization.
- Students see only their own assignment state.
- Global admin-only article/tag/member operations remain separate and must not be
  exposed through teacher workflows.

## Classroom lifecycle

A teacher can create a classroom in an organization where they have the required
membership/capability. A classroom has:

- `orgId`;
- `name`;
- `teacherId`;
- roster entries in `ClassroomMembership`.

Roster changes are scoped to the classroom. Adding a student should not grant
system admin privileges or visibility into unrelated classrooms.

### Write prompts

Each assignment can carry its own Write Prompt (in the assignment's Edit
form); otherwise the article's default applies. Students answer in the
reader's Write tab, and the classroom page links to **Written responses (n)**
per assignment, where teachers score a four-part rubric and either grade the
response or return it for revision. Students' independent writing is never
shown to teachers. See [write prompts](write-prompts.md).

### Text sets

Teachers can group readings into **Text Sets** at `/teacher/text-sets` — an
essential question, student instructions, teacher notes, and ordered readings
with guiding notes — keep them private or share them with their
organization's teachers, duplicate colleagues' sets, and assign a whole set to
classrooms as a unit. The classroom page shows unit progress and students see
the readings grouped under the essential question. See
[text sets](text-sets.md).

### Reading skills and answer-key previews

The classroom page's **Reading skills** card shows each student's percent
correct per reading skill (latest quiz attempt per assigned article) with a
class row and CSV export; org admins see the class row only. When assigning,
each selected article has a "Preview answer key & skills" link to its printable
answer key, which lists every question's skill alignment and rationale. See
[reading skills](reading-skills.md).

### Join codes

Instead of adding students one by one, a teacher or org admin can issue a join
code from the classroom page's Join code card: choose an expiry (1, 7, or 30
days, or none) and an optional seat limit (up to 1000), then share the code or the copyable
`/join-class?code=…` link. Rotating replaces the code and invalidates the old
one immediately; Disable stops new joins while existing students stay enrolled.
Archived classrooms can disable a code but not issue one.

Signed-in learners enter the code at `/join-class` (linked from `/assignments`)
or Settings → Classes and are enrolled as `Student`. A rejected code shows why
on the field — not valid, expired, class full, or class no longer active — and
the teacher's card shows how many have joined. The rules, rate limits, and
audit/security events are documented in
[Access: classroom join codes](../access/multi-tenancy.md#classroom-join-codes-1309).

## Assignment lifecycle

Assignments link a classroom to an article with optional due date and
instructions. Current lifecycle:

1. Teacher selects an accessible article and creates an assignment.
2. Students in the classroom see the assignment in `/assignments`.
3. Student reading/progress/quiz activity can update `AssignmentCompletion`.
4. Teacher analytics read aggregate and per-student status for that classroom.
5. Teachers can filter classroom analytics by assignment/student, inspect
   drilldown rows, and export the privacy-scoped view as CSV or JSON.

After the route authorizes classroom management, it calls
`createArticleAssignment` in
`src/lib/classroom/article-assignments.ts`. That workflow asks Article Library
to validate organization assignability before parsing the optional due date,
normalizes blank instructions to `null`, and creates the row. This preserves
Article Library's controlled `404`/`409` integrity outcomes ahead of due-date
validation; the route only maps the result to HTTP.

`AssignmentStatus` values are controlled by the Prisma enum:

```text
assigned, in_progress, completed
```

Completion rows are unique per `(assignmentId, studentId)`.

## Article access and IDOR safety

Assignment creation and student display must use Article Library access helpers,
not hand-rolled visibility checks. A teacher assigning an article does not make
private or unpublished article content globally visible. Student routes must
verify the authenticated user is the assigned student or an authorized teacher
for the classroom.

## Analytics

Classroom analytics are tenant-scoped education reports, not product analytics
events. They may show per-learner assignment/completion/quiz status to authorized
teachers. They must not leak:

- article text;
- selected text/highlight notes;
- prompts or AI responses;
- private user data outside the classroom.

Aggregate teacher/admin visibility rules are documented in
`analytics/tenant-reporting-privacy.md`.

`GET /api/classrooms/[id]/analytics` accepts optional `assignmentId` and
`studentId` filters. `GET /api/classrooms/[id]/analytics/export` accepts the
same filters plus `format=csv|json`. Classroom teachers and system admins receive
the same per-student/drilldown fields visible in the UI. Filters require that
individual-data access. Org admins receive aggregate-only exports with
individual rows redacted and assignments that have ever been targeted excluded,
preventing later audience widening from revealing an operator-controlled
singleton result.

## Deletion and retention

- Deleting a user cascades their classroom memberships and assignment completions.
- Deleting a classroom cascades assignments and completions.
- Assignment completion is user/classroom education data and should be included
  in account export/deletion logic according to the data-lifecycle matrix.

## Related docs

- [`../access/multi-tenancy.md`](../access/multi-tenancy.md) — tenant model, memberships, classroom schema, and cache keys.
- [`../access/rbac.md`](../access/rbac.md) — capability resolution.
- [`../analytics/tenant-reporting-privacy.md`](../analytics/tenant-reporting-privacy.md) — teacher/admin reporting visibility.
- [`learning-and-mastery.md`](./learning-and-mastery.md) — mastery and quiz signals that can appear in assignment analytics.
