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
