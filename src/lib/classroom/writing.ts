/**
 * Write Prompt constructed responses (#1305).
 *
 * Learners draft, autosave, and submit a written response to an article's
 * prompt — either for one of their classroom assignments of that article or
 * as independent writing. Prompts resolve as: assignment override → article
 * default (`WritePrompt`) → generic prompt; each submission snapshots the
 * prompt it answers.
 *
 * Privacy: independent writing (`scopeKey = "independent"`) is visible only to
 * the learner. Assignment work is visible to that classroom's managers
 * (teacher, org admin, system admin) once submitted — never as a draft.
 *
 * Status flow: DRAFT → SUBMITTED → (GRADED | NEEDS_REVISION → resubmit).
 * Assignment work is locked while SUBMITTED or GRADED; independent writing
 * can always be reopened. Teacher reviews are audited with ids, action, and
 * rubric totals only — never the response text or feedback.
 */
import { Prisma, WriteSubmissionStatus, type MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordAuditFromRequest,
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditRequestInput,
} from "@/lib/security/audit";
import { canManageClassroom } from "./guards";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "./targeting";
import {
  INDEPENDENT_WRITE_SCOPE,
  countWords,
  defaultWritePrompt,
  rubricTotal,
  sanitizeRubricScores,
  type RubricScores,
} from "./writing-rubric";

type Viewer = { id: string; role?: string | null };
type ArticleRef = { id: string; title: string };

export type WriteSubmissionView = {
  id: string;
  assignmentId: string | null;
  status: WriteSubmissionStatus;
  body: string;
  wordCount: number;
  prompt: string;
  rubricScores: RubricScores;
  teacherFeedback: string | null;
  revisionCount: number;
  submittedAt: Date | null;
  gradedAt: Date | null;
  updatedAt: Date;
};

export type WriteContext = {
  /** The learner's live assignments of this article, each with its resolved prompt. */
  assignments: Array<{ id: string; classroomName: string; prompt: string }>;
  /** Prompt for the requested scope. */
  prompt: string;
  submission: WriteSubmissionView | null;
};

export type WriteFailure =
  | { ok: false; status: 400; reason: "empty_response" }
  | { ok: false; status: 403; reason: "forbidden" }
  | { ok: false; status: 404; reason: "not_found" }
  | { ok: false; status: 409; reason: "locked" | "not_reviewable" };

const VIEW_SELECT = {
  id: true,
  assignmentId: true,
  status: true,
  body: true,
  wordCount: true,
  prompt: true,
  rubricScores: true,
  teacherFeedback: true,
  revisionCount: true,
  submittedAt: true,
  gradedAt: true,
  updatedAt: true,
} as const satisfies Prisma.WriteSubmissionSelect;

function toView(row: Prisma.WriteSubmissionGetPayload<{ select: typeof VIEW_SELECT }>): WriteSubmissionView {
  return { ...row, rubricScores: sanitizeRubricScores(row.rubricScores) };
}

async function articleDefaultPrompt(article: ArticleRef): Promise<string> {
  const stored = await prisma.writePrompt.findUnique({ where: { articleId: article.id }, select: { prompt: true } });
  return stored?.prompt ?? defaultWritePrompt(article.title);
}

async function studentAssignmentsFor(userId: string, article: ArticleRef, articlePrompt: string) {
  const rows = await prisma.assignment.findMany({
    where: {
      articleId: article.id,
      classroom: { archivedAt: null, members: { some: { userId } } },
      AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(new Date())],
    },
    select: { id: true, writePrompt: true, classroom: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    classroomName: row.classroom.name,
    prompt: row.writePrompt?.trim() || articlePrompt,
  }));
}

/** Resolves the scope; null when the assignment isn't one of the learner's. */
async function resolveScope(userId: string, article: ArticleRef, assignmentId: string | null | undefined) {
  const articlePrompt = await articleDefaultPrompt(article);
  const assignments = await studentAssignmentsFor(userId, article, articlePrompt);
  if (!assignmentId) {
    return { assignments, assignmentId: null, scopeKey: INDEPENDENT_WRITE_SCOPE, prompt: articlePrompt };
  }
  const assignment = assignments.find((entry) => entry.id === assignmentId);
  if (!assignment) return null;
  return { assignments, assignmentId, scopeKey: assignmentId, prompt: assignment.prompt };
}

function findSubmission(userId: string, articleId: string, scopeKey: string) {
  return prisma.writeSubmission.findUnique({
    where: { userId_articleId_scopeKey: { userId, articleId, scopeKey } },
    select: VIEW_SELECT,
  });
}

/** The learner's prompt, assignment choices, and existing response for a scope. */
export async function getWriteContext(
  userId: string,
  article: ArticleRef,
  assignmentId?: string | null,
): Promise<{ ok: true; context: WriteContext } | WriteFailure> {
  const scope = await resolveScope(userId, article, assignmentId);
  if (!scope) return { ok: false, status: 404, reason: "not_found" };
  const submission = await findSubmission(userId, article.id, scope.scopeKey);
  return {
    ok: true,
    context: {
      assignments: scope.assignments,
      // A response keeps answering the prompt it started with.
      prompt: submission?.prompt ?? scope.prompt,
      submission: submission ? toView(submission) : null,
    },
  };
}

function isLocked(status: WriteSubmissionStatus, scopeKey: string): boolean {
  return (
    scopeKey !== INDEPENDENT_WRITE_SCOPE &&
    (status === WriteSubmissionStatus.SUBMITTED || status === WriteSubmissionStatus.GRADED)
  );
}

type WriteInput = { assignmentId?: string | null; body: string };

async function writeResponse(
  userId: string,
  article: ArticleRef,
  input: WriteInput,
  submit: boolean,
): Promise<{ ok: true; submission: WriteSubmissionView } | WriteFailure> {
  const scope = await resolveScope(userId, article, input.assignmentId);
  if (!scope) return { ok: false, status: 404, reason: "not_found" };
  const existing = await findSubmission(userId, article.id, scope.scopeKey);
  if (existing && isLocked(existing.status, scope.scopeKey)) return { ok: false, status: 409, reason: "locked" };
  const wordCount = countWords(input.body);
  if (submit && wordCount === 0) return { ok: false, status: 400, reason: "empty_response" };

  const wasReturned = existing?.status === WriteSubmissionStatus.NEEDS_REVISION;
  const status = submit
    ? WriteSubmissionStatus.SUBMITTED
    : wasReturned
      ? WriteSubmissionStatus.NEEDS_REVISION
      : WriteSubmissionStatus.DRAFT;
  const data = {
    body: input.body,
    wordCount,
    status,
    ...(submit
      ? { submittedAt: new Date(), ...(wasReturned ? { revisionCount: { increment: 1 } } : {}) }
      : {}),
  };
  const row = await prisma.writeSubmission.upsert({
    where: { userId_articleId_scopeKey: { userId, articleId: article.id, scopeKey: scope.scopeKey } },
    create: {
      userId,
      articleId: article.id,
      assignmentId: scope.assignmentId,
      scopeKey: scope.scopeKey,
      prompt: scope.prompt,
      ...data,
      revisionCount: 0,
    },
    update: data,
    select: VIEW_SELECT,
  });
  return { ok: true, submission: toView(row) };
}

/** Autosaves a draft (keeps NEEDS_REVISION while the learner revises). */
export function saveWriteDraft(userId: string, article: ArticleRef, input: WriteInput) {
  return writeResponse(userId, article, input, false);
}

/** Submits the response; a returned response counts as a revision. */
export function submitWriteResponse(userId: string, article: ArticleRef, input: WriteInput) {
  return writeResponse(userId, article, input, true);
}

// ---------------------------------------------------------------------------
// Teacher review
// ---------------------------------------------------------------------------

async function managedAssignment(assignmentId: string, viewer: Viewer) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      writePrompt: true,
      article: { select: { id: true, title: true } },
      classroom: { select: { id: true, name: true, orgId: true, teacherId: true } },
    },
  });
  if (!assignment) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: viewer.id, orgId: assignment.classroom.orgId } },
    select: { role: true },
  });
  const allowed = canManageClassroom(viewer, assignment.classroom, membership as { role: MembershipRole } | null);
  return { assignment, allowed };
}

export type AssignmentSubmissionRow = WriteSubmissionView & {
  student: { id: string; name: string | null; email: string | null };
};

/**
 * Submitted (non-draft) responses for an assignment, for its classroom's
 * managers. 404 when the assignment is missing; 403 for anyone else.
 */
export async function listAssignmentSubmissions(
  assignmentId: string,
  viewer: Viewer,
): Promise<
  | {
      ok: true;
      assignment: { id: string; classroomId: string; classroomName: string; articleId: string; articleTitle: string; prompt: string };
      submissions: AssignmentSubmissionRow[];
    }
  | WriteFailure
> {
  const managed = await managedAssignment(assignmentId, viewer);
  if (!managed) return { ok: false, status: 404, reason: "not_found" };
  if (!managed.allowed) return { ok: false, status: 403, reason: "forbidden" };
  const { assignment } = managed;
  const rows = await prisma.writeSubmission.findMany({
    where: { assignmentId, status: { not: WriteSubmissionStatus.DRAFT } },
    select: { ...VIEW_SELECT, user: { select: { id: true, name: true, email: true } } },
    orderBy: { submittedAt: "asc" },
  });
  return {
    ok: true,
    assignment: {
      id: assignment.id,
      classroomId: assignment.classroom.id,
      classroomName: assignment.classroom.name,
      articleId: assignment.article.id,
      articleTitle: assignment.article.title,
      prompt: assignment.writePrompt?.trim() || (await articleDefaultPrompt(assignment.article)),
    },
    submissions: rows.map(({ user, ...row }) => ({ ...toView(row), student: user })),
  };
}

export type ReviewInput = {
  action: "grade" | "return";
  rubricScores: unknown;
  feedback?: string | null;
};

/**
 * Grades or returns an assignment response. Only submitted or graded work can
 * be reviewed; independent writing is never reviewable (404, so it isn't
 * disclosed). The audit row is written in the same transaction.
 */
export async function reviewWriteSubmission(
  submissionId: string,
  viewer: Viewer,
  input: ReviewInput,
  audit: (entry: { action: AuditAction; metadata: Record<string, unknown> }) => AuditRequestInput,
): Promise<{ ok: true; submission: WriteSubmissionView } | WriteFailure> {
  const submission = await prisma.writeSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, assignmentId: true, status: true },
  });
  if (!submission?.assignmentId) return { ok: false, status: 404, reason: "not_found" };
  const managed = await managedAssignment(submission.assignmentId, viewer);
  if (!managed) return { ok: false, status: 404, reason: "not_found" };
  if (!managed.allowed) return { ok: false, status: 403, reason: "forbidden" };
  if (submission.status !== WriteSubmissionStatus.SUBMITTED && submission.status !== WriteSubmissionStatus.GRADED) {
    return { ok: false, status: 409, reason: "not_reviewable" };
  }

  const rubricScores = sanitizeRubricScores(input.rubricScores);
  const graded = input.action === "grade";
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.writeSubmission.update({
      where: { id: submissionId },
      data: {
        status: graded ? WriteSubmissionStatus.GRADED : WriteSubmissionStatus.NEEDS_REVISION,
        rubricScores,
        teacherFeedback: input.feedback?.trim() || null,
        gradedAt: graded ? new Date() : null,
        gradedById: viewer.id,
      },
      select: VIEW_SELECT,
    });
    await recordAuditFromRequest(
      audit({
        action: graded ? AUDIT_ACTIONS.writeSubmissionGraded : AUDIT_ACTIONS.writeSubmissionReturned,
        metadata: {
          assignmentId: submission.assignmentId,
          classroomId: managed.assignment.classroom.id,
          rubric: rubricTotal(rubricScores),
        },
      }),
      tx,
    );
    return updated;
  });
  return { ok: true, submission: toView(row) };
}

/** The article's stored default Write Prompt, or null when it uses the generic one. */
export async function getArticleWritePrompt(articleId: string): Promise<string | null> {
  return (await prisma.writePrompt.findUnique({ where: { articleId }, select: { prompt: true } }))?.prompt ?? null;
}
