/**
 * Assignment completion commands.
 *
 * Handles recording student progress on assignments. The student identity is
 * always derived from the caller (session-derived in routes) — never from an
 * untrusted body. {@link getStudentAssignmentContext} enforces enrollment before
 * any completion is written.
 */
import {
  AssignmentCompletionSource,
  AssignmentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCompletePercent } from "@/lib/engagement/progress-rules";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "./targeting";

/** Minimum reading percent (inclusive) at/above which an assignment advances from ASSIGNED to IN_PROGRESS. */
export const ASSIGNMENT_START_PERCENT = 1;

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
): Promise<{ assignmentId: string; classroomId: string; classroomArchivedAt: Date | null } | null> {
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentId,
      classroom: { members: { some: { userId: studentId } } },
      AND: [assignmentVisibleToStudentWhere(studentId), assignmentLiveWhere(new Date())],
    },
    select: { id: true, classroomId: true, classroom: { select: { archivedAt: true } } },
  });
  return assignment
    ? {
        assignmentId: assignment.id,
        classroomId: assignment.classroomId,
        classroomArchivedAt: assignment.classroom.archivedAt,
      }
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
  const completionSource =
    status === AssignmentStatus.COMPLETED ? AssignmentCompletionSource.SELF : null;
  return prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    update: {
      status,
      ...(quizScore === undefined ? {} : { quizScore }),
      completionSource,
      completedAt,
    },
    create: {
      assignmentId,
      studentId,
      status,
      quizScore: quizScore ?? null,
      completionSource,
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
  const now = new Date();
  const assignments = await prisma.assignment.findMany({
    where: {
      articleId,
      classroom: { archivedAt: null, members: { some: { userId } } },
      AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(now)],
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
          completionSource: AssignmentCompletionSource.QUIZ,
          completedAt,
        },
        create: {
          assignmentId: assignment.id,
          studentId: userId,
          status: AssignmentStatus.COMPLETED,
          quizScore,
          completionSource: AssignmentCompletionSource.QUIZ,
          completedAt,
        },
      }),
    ),
  );
  return { completedCount: assignments.length };
}

/**
 * Upserts teacher feedback and review metadata on an assignment completion row.
 * Creates the row with status ASSIGNED if the student hasn't started yet, so a
 * teacher can leave feedback proactively. `reviewedBy` is a plain string (user id)
 * and is never treated as a FK — review metadata survives account deletion.
 */
export async function reviewAssignmentCompletion(
  assignmentId: string,
  studentId: string,
  input: { feedback: string | null; pointsAwarded?: number | null; reviewedBy: string },
) {
  const feedback = input.feedback?.trim() || null;
  const reviewedAt = new Date();
  const scorePatch = input.pointsAwarded === undefined ? {} : { pointsAwarded: input.pointsAwarded };
  return prisma.assignmentCompletion.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    update: { feedback, reviewedAt, reviewedBy: input.reviewedBy, ...scorePatch },
    create: {
      assignmentId,
      studentId,
      status: AssignmentStatus.ASSIGNED,
      feedback,
      pointsAwarded: input.pointsAwarded ?? null,
      reviewedAt,
      reviewedBy: input.reviewedBy,
    },
  });
}

/**
 * Monotonically advances every active assignment for `articleId` in classrooms
 * the student is enrolled in, based on reading progress. Never downgrades a
 * status, never clears or overwrites an existing `quizScore`, and keeps
 * `completedAt` sticky (only stamped on the first reading-driven completion).
 *
 * Called as a best-effort side effect after a progress save — the student
 * identity is always session-derived (userId), never from an untrusted body.
 * Short-circuits before any DB read when `percent` is below the start threshold
 * and the article is not already `completed`.
 */
export async function syncAssignmentReadingProgress(input: {
  userId: string;
  articleId: string;
  percent: number;
  completed: boolean;
}): Promise<{ updatedCount: number }> {
  const { userId, articleId, percent, completed } = input;
  if (percent < ASSIGNMENT_START_PERCENT && !completed) {
    return { updatedCount: 0 };
  }
  const liveNow = new Date();
  const assignments = await prisma.assignment.findMany({
    where: {
      articleId,
      classroom: { archivedAt: null, members: { some: { userId } } },
      AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(liveNow)],
    },
    select: { id: true },
  });
  if (assignments.length === 0) {
    return { updatedCount: 0 };
  }
  const targetStatus = isCompletePercent(percent) || completed
    ? AssignmentStatus.COMPLETED
    : AssignmentStatus.IN_PROGRESS;
  const now = new Date();
  const writes = await Promise.all(
    assignments.map(async (assignment) => {
      const identity = {
        assignmentId: assignment.id,
        studentId: userId,
      };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (targetStatus === AssignmentStatus.COMPLETED) {
          const withReadingSource = await prisma.assignmentCompletion.updateMany({
            where: {
              ...identity,
              status: { not: AssignmentStatus.COMPLETED },
              completionSource: null,
            },
            data: {
              status: AssignmentStatus.COMPLETED,
              completionSource: AssignmentCompletionSource.READING,
              completedAt: now,
            },
          });
          if (withReadingSource.count === 1) return true;

          const preservingSource = await prisma.assignmentCompletion.updateMany({
            where: {
              ...identity,
              status: { not: AssignmentStatus.COMPLETED },
            },
            data: {
              status: AssignmentStatus.COMPLETED,
              completedAt: now,
            },
          });
          if (preservingSource.count === 1) return true;
        } else {
          const advanced = await prisma.assignmentCompletion.updateMany({
            where: { ...identity, status: AssignmentStatus.ASSIGNED },
            data: { status: AssignmentStatus.IN_PROGRESS },
          });
          if (advanced.count === 1) return true;
        }

        try {
          await prisma.assignmentCompletion.create({
            data: {
              ...identity,
              status: targetStatus,
              ...(targetStatus === AssignmentStatus.COMPLETED
                ? { completionSource: AssignmentCompletionSource.READING }
                : {}),
              completedAt:
                targetStatus === AssignmentStatus.COMPLETED ? now : null,
              quizScore: null,
            },
          });
          return true;
        } catch (error) {
          const raced =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002";
          if (!raced) throw error;
        }
      }

      return false;
    }),
  );
  return { updatedCount: writes.filter(Boolean).length };
}
