/**
 * Student-facing assignment read queries.
 *
 * Returns a student's own assignments and completion statuses across all their
 * classrooms. Only the requesting student's completion data is included — no
 * peer data is exposed.
 */
import { AssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "./targeting";

export type StudentAssignment = {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  articleId: string;
  articleTitle: string;
  title: string | null;
  points: number | null;
  pointsAwarded: number | null;
  dueDate: Date | null;
  instructions: string | null;
  feedback: string | null;
  status: AssignmentStatus;
  quizScore: number | null;
  completedAt: Date | null;
};

type AssignmentWithStudentCompletion = Awaited<
  ReturnType<typeof prisma.assignment.findMany>
>[number] & {
  classroom: { id: string; name: string };
  article: { id: string; title: string };
  completions: Array<{
    status: AssignmentStatus;
    quizScore: number | null;
    pointsAwarded: number | null;
    completedAt: Date | null;
    feedback: string | null;
  }>;
};

function assignmentIncludeForStudent(studentId: string) {
  return {
    classroom: { select: { id: true, name: true } },
    article: { select: { id: true, title: true } },
    completions: { where: { studentId }, take: 1 },
  };
}

function mapStudentAssignment(assignment: AssignmentWithStudentCompletion): StudentAssignment {
  const completion = assignment.completions[0];
  return {
    assignmentId: assignment.id,
    classroomId: assignment.classroom.id,
    classroomName: assignment.classroom.name,
    articleId: assignment.article.id,
    articleTitle: assignment.article.title,
    title: assignment.title,
    points: assignment.points,
    pointsAwarded: completion?.pointsAwarded ?? null,
    dueDate: assignment.dueDate,
    instructions: assignment.instructions,
    feedback: completion?.feedback ?? null,
    status: completion?.status ?? AssignmentStatus.ASSIGNED,
    quizScore: completion?.quizScore ?? null,
    completedAt: completion?.completedAt ?? null,
  };
}

function dueDateSortValue(assignment: StudentAssignment): number {
  return assignment.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
}

function compareByDueDateAsc(left: StudentAssignment, right: StudentAssignment): number {
  return dueDateSortValue(left) - dueDateSortValue(right);
}

/**
 * A student's assigned readings across all their classrooms, with the student's
 * OWN completion status. Sorted by due date (soonest first, undated last) then
 * newest. Only the requesting student's completion is included — no peers'.
 */
export async function listAssignmentsForStudent(
  studentId: string,
): Promise<StudentAssignment[]> {
  const now = new Date();
  const rows = (await prisma.assignment.findMany({
    where: {
      classroom: { archivedAt: null, members: { some: { userId: studentId } } },
      AND: [assignmentVisibleToStudentWhere(studentId), assignmentLiveWhere(now)],
    },
    include: assignmentIncludeForStudent(studentId),
    orderBy: [{ createdAt: "desc" }],
  })) as AssignmentWithStudentCompletion[];

  return rows.map(mapStudentAssignment).sort(compareByDueDateAsc);
}

/**
 * A student's own assignments for a specific article, across all their enrolled
 * non-archived classrooms. Used by the reader banner to surface assignment
 * context (classroom, due date, instructions, status) without exposing peer data.
 * Returns an empty array when the article is not assigned to the student.
 */
export async function listStudentAssignmentsForArticle(
  userId: string,
  articleId: string,
): Promise<StudentAssignment[]> {
  const now = new Date();
  const rows = (await prisma.assignment.findMany({
    where: {
      articleId,
      classroom: { archivedAt: null, members: { some: { userId } } },
      AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(now)],
    },
    include: assignmentIncludeForStudent(userId),
    orderBy: [{ createdAt: "desc" }],
  })) as AssignmentWithStudentCompletion[];

  return rows.map(mapStudentAssignment).sort(compareByDueDateAsc);
}
