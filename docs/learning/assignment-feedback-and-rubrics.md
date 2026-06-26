# Assignment Feedback & Rubric Workflow Design

**Status:** Design / RFC — no code changes yet  
**Issue:** [#742](https://github.com/huangyingting/ReadWise/issues/742)  
**Epic:** [#740](https://github.com/huangyingting/ReadWise/issues/740)  
**Subsystem:** `src/lib/classroom/`, `prisma/schema.prisma`

---

## 1. Purpose

Assignment completion exists today — students self-report progress on a reading
assignment and optionally record a quiz score. What is missing is the ability for
teachers to:

- Leave qualitative feedback on a student's completion.
- Optionally score completions against named rubric criteria.
- Control what feedback is visible to the student and when.

This document proposes the data model, service seams, authorization rules, and a
phased delivery plan that builds on the existing assignment/completion model
without disrupting the learner-private study data (reading progress, word
mastery, quiz history) that sits behind privacy boundaries.

---

## 2. Existing Model (ground truth)

All items in this section already exist in the codebase.

### 2.1 Prisma models

```
// prisma/schema.prisma (existing)

model Assignment {
  id           String    @id @default(cuid())
  classroomId  String
  articleId    String
  dueDate      DateTime?
  instructions String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  classroom   Classroom              @relation(...)
  article     Article                @relation(...)
  completions AssignmentCompletion[]
}

model AssignmentCompletion {
  id           String           @id @default(cuid())
  assignmentId String
  studentId    String
  status       AssignmentStatus @default(ASSIGNED)   // ASSIGNED | IN_PROGRESS | COMPLETED
  quizScore    Int?             // 0–100, clamped
  completedAt  DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  assignment Assignment @relation(...)
  student    User       @relation(...)

  @@unique([assignmentId, studentId])
}
```

### 2.2 Service entry points

| Function | File | Notes |
|---|---|---|
| `assignArticle` | `src/lib/classroom/commands.ts` | Creates an `Assignment` |
| `deleteAssignment` | `src/lib/classroom/commands.ts` | Cascades completions |
| `getStudentAssignmentContext` | `src/lib/classroom/completions.ts` | Enrollment guard before write |
| `recordAssignmentCompletion` | `src/lib/classroom/completions.ts` | Upsert student progress |
| `listAssignmentsForStudent` | `src/lib/classroom/student-reads.ts` | Student's view — own completion only |
| `getClassroomProgressData` | `src/lib/classroom/progress.ts` | Raw matrix for analytics |

### 2.3 Authorization helpers

| Helper | File | Who it admits |
|---|---|---|
| `canManageClassroom` | `src/lib/classroom/guards.ts` | System admin, Org admin, classroom teacher |
| `requireClassroomManageApi` | `src/lib/tenant-api.ts` | API-layer version of above; throws `ApiError` |
| `getStudentAssignmentContext` | `src/lib/classroom/completions.ts` | Guards student completion — 404 if not enrolled |

### 2.4 Capability constants (existing, `src/lib/rbac.ts`)

```
CAPABILITIES.classroomManage            // "classroom.manage"
CAPABILITIES.classroomAssignmentsManage // "classroom.assignments.manage"
CAPABILITIES.classroomStudentsManage    // "classroom.students.manage"
```

---

## 3. Privacy Boundary

The most important design constraint in this system is the separation between
**teacher-visible assignment facts** and **learner-private study details**.

| Category | Examples | Visibility |
|---|---|---|
| Assignment facts | status, completedAt, quizScore, teacher feedback, rubric scores | Teacher AND student (the student's own row only) |
| Learner-private study data | ReadingProgress, WordMastery, QuizAttempt, SavedWord, highlights, notes | Student only — never surfaced to the teacher via this feature |

The existing `listAssignmentsForStudent` already enforces isolation: it filters
completions by `where: { studentId }` so a student only sees their own record.
Teacher-side reads (via `getClassroomProgressData`) surface the completion matrix
but must never join into mastery or quiz-attempt tables.

**Rule:** Any new teacher-facing query MUST select only from `Assignment`,
`AssignmentCompletion`, `AssignmentFeedback` (new), `Rubric` (new), and
`RubricScore` (new). It MUST NOT join `QuizAttempt`, `WordMastery`,
`ArticleMastery`, `ReadingProgress`, `SavedWord`, or any other learner-private
table.

---

## 4. Proposed Data Model

All items in this section are **new** — they do not exist yet.

### 4.1 Rubric and criteria

A `Rubric` is a reusable template that a teacher attaches to one or more
assignments. A `RubricCriterion` is a single named dimension within a rubric
(e.g. "Comprehension", "Vocabulary Use").

```prisma
// NEW — to be added to prisma/schema.prisma

model Rubric {
  id          String   @id @default(cuid())
  classroomId String
  name        String   // e.g. "Week 3 Reading Rubric"
  description String?
  maxScore    Int      @default(4)  // points per criterion (1–N)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  classroom  Classroom        @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  criteria   RubricCriterion[]
  assignments Assignment[]    @relation("AssignmentRubric")

  @@index([classroomId])
}

model RubricCriterion {
  id          String  @id @default(cuid())
  rubricId    String
  label       String  // "Comprehension", "Vocabulary Use", etc.
  description String?
  order       Int     @default(0)

  rubric  Rubric       @relation(fields: [rubricId], references: [id], onDelete: Cascade)
  scores  RubricScore[]

  @@index([rubricId])
}
```

### 4.2 Feedback and rubric scores on completions

`AssignmentFeedback` is a **one-to-one** extension of `AssignmentCompletion`
written by the teacher (or an authorized proxy). `RubricScore` records the
per-criterion score within that feedback.

```prisma
// NEW

model AssignmentFeedback {
  id           String   @id @default(cuid())
  completionId String   @unique
  teacherId    String                    // who submitted the feedback
  note         String?                  // qualitative comment — never logged
  releasedAt   DateTime?                // null = draft; non-null = visible to student
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  completion   AssignmentCompletion @relation(fields: [completionId], references: [id], onDelete: Cascade)
  teacher      User                 @relation("FeedbackAuthor", fields: [teacherId], references: [id])
  scores       RubricScore[]

  @@index([teacherId])
}

model RubricScore {
  id          String @id @default(cuid())
  feedbackId  String
  criterionId String
  score       Int    // 0 to Rubric.maxScore

  feedback  AssignmentFeedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  criterion RubricCriterion    @relation(fields: [criterionId], references: [id], onDelete: Cascade)

  @@unique([feedbackId, criterionId])
  @@index([criterionId])
}
```

**Also add to `Assignment` (new optional field):**

```prisma
// NEW — add to existing Assignment model
rubricId  String?
rubric    Rubric? @relation("AssignmentRubric", fields: [rubricId], references: [id])
```

**Also add to `AssignmentCompletion` (new optional relation):**

```prisma
// NEW — add to existing AssignmentCompletion model
feedback  AssignmentFeedback?
```

### 4.3 Why this shape?

- **`AssignmentFeedback` is separate from `AssignmentCompletion`** — completions
  are student-owned; feedback is teacher-owned. The relation is one-to-one but the
  write paths are completely different and governed by different authorization
  guards.
- **`releasedAt` draft gate** — teachers can score in draft mode before revealing
  feedback to students. A `null` `releasedAt` means the feedback exists but is not
  yet readable by the student.
- **`note` is qualitative and private** — it MUST NOT appear in any log line,
  audit event payload, or API response to a non-teacher viewer. See
  [Section 6](#6-privacy-and-logging-rules).
- **`RubricScore.score` is validated at write time** against `Rubric.maxScore`.
- **Rubrics are classroom-scoped** — a teacher cannot use another classroom's
  rubric, preventing cross-tenant data leakage.

---

## 5. Workflow

### 5.1 Teacher creates a rubric

1. Teacher opens the classroom dashboard.
2. Teacher creates a `Rubric` with a name, optional description, max score per
   criterion, and an ordered list of `RubricCriterion` labels.
3. **API:** `POST /api/classrooms/[id]/rubrics` — guarded by
   `requireClassroomManageApi` (existing guard, no change needed).
4. **Service:** `createRubric(input)` in `src/lib/classroom/rubrics.ts` (new
   module). Written inside a single transaction: `Rubric` then
   `RubricCriterion[]` rows.

### 5.2 Teacher assigns an article with an optional rubric

1. In `AssignArticleForm` the teacher optionally selects a rubric from the
   classroom's rubric list.
2. **API:** `POST /api/classrooms/[id]/assignments` body gains an optional
   `rubricId` field.
3. **Service:** `assignArticle` in `src/lib/classroom/commands.ts` accepts an
   optional `rubricId` on `AssignArticleInput` and writes it to `Assignment.rubricId`.

### 5.3 Student completes the assignment

No change to the existing completion flow. The student posts to
`POST /api/assignments/[id]/completion` with `{ status, quizScore }`. The server
derives `studentId` from the session — never the body. This path does not touch
`AssignmentFeedback`.

### 5.4 Teacher reviews completions and leaves feedback

1. Teacher opens the classroom progress view.
2. Teacher selects a student's completion row.
3. Teacher enters criterion scores and an optional note. Feedback starts as a
   draft (`releasedAt: null`).
4. Teacher explicitly releases feedback (sets `releasedAt`).
5. **API:** `POST /api/assignments/[id]/feedback/[studentId]` — guarded by
   `requireClassroomManageApi`. Validates `teacherId` == session user,
   validates criterion IDs belong to the assignment's rubric, clamps scores.
6. **Service:** `upsertAssignmentFeedback(input)` in
   `src/lib/classroom/feedback.ts` (new module). Uses `upsert` on
   `AssignmentFeedback` keyed on `completionId`.

**Release endpoint:** `PATCH /api/assignments/[id]/feedback/[studentId]` with
`{ releasedAt: <ISO timestamp> }`. Sets `releasedAt` to stamp feedback as visible.

### 5.5 Student views their feedback

1. Student loads their assignment detail page.
2. **API:** `GET /api/assignments/[id]/my-feedback` — guarded by enrollment
   check (`getStudentAssignmentContext`). Returns `AssignmentFeedback` **only if**
   `releasedAt` is non-null.
3. The response includes criterion labels, scores, and `note`. It MUST NOT include
   the teacher's `id` or internal IDs beyond what the student needs.
4. **Service:** `getReleasedFeedbackForStudent(assignmentId, studentId)` in
   `src/lib/classroom/feedback.ts`.

---

## 6. Authorization Summary

| Action | Guard | Notes |
|---|---|---|
| Create/edit rubric | `canManageClassroom` | Teacher or Org admin in that classroom's org |
| Attach rubric to assignment | `requireClassroomManageApi` | Existing guard, extended body only |
| Write / release feedback | `requireClassroomManageApi` | Must also verify `assignment.classroomId` matches rubric's `classroomId` |
| Read all completions + feedback | `canManageClassroom` | Teacher-only; never includes learner-private tables |
| Read own released feedback | `getStudentAssignmentContext` | Student; `releasedAt IS NOT NULL` filter enforced in query |
| Read peer feedback | — | **Forbidden.** studentId is always taken from session |

Cross-classroom checks: every rubric lookup must validate
`rubric.classroomId == assignment.classroomId`. This is enforced in the service
layer, not only in the API layer.

---

## 7. Privacy and Logging Rules

- **`AssignmentFeedback.note`** is a free-text field. It MUST NOT be written to
  any log line, `AuditLog` payload, analytics event, or `console.*` output.
- Teacher-facing queries must select ONLY from
  `Assignment / AssignmentCompletion / AssignmentFeedback / RubricScore` — never
  join into `QuizAttempt`, `WordMastery`, `ReadingProgress`, `SavedWord`,
  `PronunciationAttempt`, or any other learner-private model.
- API responses to teacher endpoints MUST NOT include `studentId` of peers — only
  the specific student's row (identified by `studentId` path param).
- Draft feedback (`releasedAt: null`) MUST NOT appear in any student-facing API
  response, even if the student somehow knows the completion ID.
- Rubric names and criterion labels may be logged (they are teacher-authored
  structural metadata, not student content).

---

## 8. New Service Modules

| Module | Path | Exports |
|---|---|---|
| Rubric CRUD | `src/lib/classroom/rubrics.ts` | `createRubric`, `getRubric`, `listRubricsForClassroom`, `deleteRubric` |
| Feedback CRUD | `src/lib/classroom/feedback.ts` | `upsertAssignmentFeedback`, `releaseFeedback`, `getReleasedFeedbackForStudent`, `listFeedbackForAssignment` |

Both modules follow the same pattern as the existing `completions.ts` and
`commands.ts` — pure service functions, no HTTP concerns, exported from
`src/lib/classroom/index.ts`.

### Barrel additions to `src/lib/classroom/index.ts` (new exports)

```ts
export {
  type CreateRubricInput,
  createRubric,
  getRubric,
  listRubricsForClassroom,
  deleteRubric,
} from "./rubrics";

export {
  type UpsertFeedbackInput,
  type ReleasedFeedback,
  upsertAssignmentFeedback,
  releaseFeedback,
  getReleasedFeedbackForStudent,
  listFeedbackForAssignment,
} from "./feedback";
```

---

## 9. New API Routes

| Method | Path | Handler | Guard |
|---|---|---|---|
| `POST` | `/api/classrooms/[id]/rubrics` | Create rubric | `requireClassroomManageApi` |
| `GET` | `/api/classrooms/[id]/rubrics` | List rubrics | `requireClassroomManageApi` |
| `DELETE` | `/api/classrooms/[id]/rubrics/[rubricId]` | Delete rubric | `requireClassroomManageApi` |
| `POST` | `/api/assignments/[id]/feedback/[studentId]` | Upsert feedback | `requireClassroomManageApi` |
| `PATCH` | `/api/assignments/[id]/feedback/[studentId]` | Release feedback | `requireClassroomManageApi` |
| `GET` | `/api/assignments/[id]/my-feedback` | Get own released feedback | Enrollment guard only |

---

## 10. UI Surfaces

### Teacher dashboard (new panels)

- **Rubric manager** — create/list/delete rubrics for a classroom.
- **Completion detail drawer** — clicking a student row in the progress table
  opens a drawer showing: completion status, quiz score (existing), and a rubric
  scoring form (new) with a note field and a "Save draft" / "Release to student"
  button.

### Student assignment view (new section)

- **Feedback card** — shown below the assignment details when
  `getReleasedFeedbackForStudent` returns a non-null record. Displays criterion
  labels, scores (rendered as e.g. "3 / 4"), and the teacher's note.

Both surfaces should use existing design-system components (`Field`, `Textarea`,
`Button`, `Input`) from `src/components/ui/`.

---

## 11. Phased Delivery Plan

### Phase 1 — Schema & service layer (no UI)

1. Add `Rubric`, `RubricCriterion`, `AssignmentFeedback`, `RubricScore` to
   `prisma/schema.prisma` (and `prisma/postgresql/schema.prisma`).
2. Add optional `rubricId` to `Assignment`; optional `feedback` relation to
   `AssignmentCompletion`.
3. Write and test `src/lib/classroom/rubrics.ts` and
   `src/lib/classroom/feedback.ts`.
4. Export new functions from `src/lib/classroom/index.ts`.
5. Add tests for authorization (teacher, student, cross-classroom) and privacy
   boundary (no mastery/quiz join).

### Phase 2 — API routes

1. Implement the six new routes listed in [Section 9](#9-new-api-routes).
2. Extend `POST /api/classrooms/[id]/assignments` to accept optional `rubricId`.
3. Validation: clamp scores to `0..rubric.maxScore`; verify criterion IDs belong
   to the rubric; verify rubric belongs to the assignment's classroom.

### Phase 3 — Teacher UI

1. Rubric manager panel in the classroom dashboard.
2. Completion detail drawer with the rubric scoring form and draft/release
   workflow.

### Phase 4 — Student UI

1. Feedback card on the student's assignment detail page, shown only when
   `releasedAt` is non-null.

### Out of scope (this design)

- Gradebook or LMS export.
- AI-assisted rubric generation.
- Broad learning-mastery recalibration from rubric scores.
- Peer-review / student-to-student feedback.

---

## 12. Checklist (Acceptance Criteria)

- [ ] Privacy boundary documented: teacher-visible fields vs learner-private data.
- [ ] `AssignmentFeedback.note` never logged or included in non-teacher responses.
- [ ] Draft-gate enforced: `releasedAt IS NULL` → not visible to student.
- [ ] Cross-classroom rubric use prevented in service layer.
- [ ] `studentId` always from session in student-facing routes.
- [ ] Authorization tests cover: teacher OK, student forbidden, peer student
      forbidden, cross-classroom teacher forbidden.
- [ ] New models added to both `prisma/schema.prisma` and
      `prisma/postgresql/schema.prisma` with matching migrations.
- [ ] New service modules follow existing naming patterns
      (`src/lib/classroom/rubrics.ts`, `src/lib/classroom/feedback.ts`).
- [ ] Exports added to `src/lib/classroom/index.ts`.

---

## Related docs

- [`access/multi-tenancy.md`](../access/multi-tenancy.md) — tenancy model,
  classroom roles, authorization helpers.
- [`access/rbac.md`](../access/rbac.md) — capability table and role resolution.
- [`learning/learning-and-mastery.md`](./learning-and-mastery.md) — learner-private
  study data that MUST NOT be joined into teacher-facing queries.
- [`analytics/product-analytics.md`](../analytics/product-analytics.md) — event
  logging rules (do not log `note` content here either).
