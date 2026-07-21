/**
 * Student-facing assignment read queries.
 *
 * Returns a student's own assignments and completion statuses across all their
 * classrooms. Only the requesting student's completion data is included — no
 * peer data is exposed.
 */
import { AssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type StudentAssignment = {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  articleId: string;
  articleTitle: string;
  dueDate: Date | null;
  instructions: string | null;
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
    completedAt: Date | null;
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
    dueDate: assignment.dueDate,
    instructions: assignment.instructions,
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
  const rows = (await prisma.assignment.findMany({
    where: { classroom: { archivedAt: null, members: { some: { userId: studentId } } } },
    include: assignmentIncludeForStudent(studentId),
    orderBy: [{ createdAt: "desc" }],
  })) as AssignmentWithStudentCompletion[];

  return rows.map(mapStudentAssignment).sort(compareByDueDateAsc);
}
