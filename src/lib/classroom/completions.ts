/**
 * Assignment completion commands.
 *
 * Handles recording student progress on assignments. The student identity is
 * always derived from the caller (session-derived in routes) — never from an
 * untrusted body. {@link getStudentAssignmentContext} enforces enrollment before
 * any completion is written.
 */
import { AssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type RecordCompletionInput = {
  status?: AssignmentStatus;
  quizScore?: number | null;
};

function normalizeQuizScore(score: number | null | undefined): number | undefined {
  return score == null ? undefined : Math.min(100, Math.max(0, Math.round(score)));
}

function completionTimestamp(status: AssignmentStatus): Date | null {
  return status === AssignmentStatus.COMPLETED ? new Date() : null;
}

/**
 * Resolves an assignment ONLY if `studentId` is enrolled in its classroom.
 * Returns null when the assignment doesn't exist OR the user isn't a member —
 * so a student can never report completion on an assignment that isn't theirs.
 */
export async function getStudentAssignmentContext(
  assignmentId: string,
  studentId: string,
): Promise<{ assignmentId: string; classroomId: string } | null> {
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentId,
      classroom: { members: { some: { userId: studentId } } },
    },
    select: { id: true, classroomId: true },
  });
  return assignment
    ? { assignmentId: assignment.id, classroomId: assignment.classroomId }
    : null;
}

/**
 * Records (upserts) a student's progress on an assignment. When the status is
 * COMPLETED, `completedAt` is stamped (idempotently). A quiz score, if provided,
 * is clamped to 0–100.
 */
export async function recordAssignmentCompletion(
  assignmentId: string,
  studentId: string,
  input: RecordCompletionInput = {},
) {
  const status = input.status ?? AssignmentStatus.COMPLETED;
  const quizScore = normalizeQuizScore(input.quizScore);
  const completedAt = completionTimestamp(status);
  return prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    update: {
      status,
      ...(quizScore === undefined ? {} : { quizScore }),
      completedAt,
    },
    create: {
      assignmentId,
      studentId,
      status,
      quizScore: quizScore ?? null,
      completedAt,
    },
  });
}

/**
 * Marks EVERY active assignment of `articleId` complete for the student, for
 * each classroom the student is enrolled in. Called as a best-effort side
 * effect after a quiz attempt is graded — the student id and score are always
 * server-derived (session + server-graded score), never trusted from a body.
 *
 * The same article may be assigned in more than one enrolled classroom, so all
 * matching assignments are upserted to COMPLETED with the (clamped) quiz score.
 * Returns the number of assignments that were marked complete.
 */
export async function markAssignmentQuizComplete(input: {
  userId: string;
  articleId: string;
  scorePct: number;
}): Promise<{ completedCount: number }> {
  const { userId, articleId, scorePct } = input;
  const assignments = await prisma.assignment.findMany({
    where: {
      articleId,
      classroom: { members: { some: { userId } } },
    },
    select: { id: true },
  });
  if (assignments.length === 0) {
    return { completedCount: 0 };
  }
  const quizScore = normalizeQuizScore(scorePct) ?? null;
  const completedAt = new Date();
  await Promise.all(
    assignments.map((assignment) =>
      prisma.assignmentCompletion.upsert({
        where: {
          assignmentId_studentId: { assignmentId: assignment.id, studentId: userId },
        },
        update: {
          status: AssignmentStatus.COMPLETED,
          quizScore,
          completedAt,
        },
        create: {
          assignmentId: assignment.id,
          studentId: userId,
          status: AssignmentStatus.COMPLETED,
          quizScore,
          completedAt,
        },
      }),
    ),
  );
  return { completedCount: assignments.length };
}
