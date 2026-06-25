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

/**
 * A student's assigned readings across all their classrooms, with the student's
 * OWN completion status. Sorted by due date (soonest first, undated last) then
 * newest. Only the requesting student's completion is included — no peers'.
 */
export async function listAssignmentsForStudent(
  studentId: string,
): Promise<StudentAssignment[]> {
  const rows = await prisma.assignment.findMany({
    where: { classroom: { members: { some: { userId: studentId } } } },
    include: {
      classroom: { select: { id: true, name: true } },
      article: { select: { id: true, title: true } },
      completions: { where: { studentId }, take: 1 },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  const mapped: StudentAssignment[] = rows.map((a) => {
    const mine = a.completions[0];
    return {
      assignmentId: a.id,
      classroomId: a.classroom.id,
      classroomName: a.classroom.name,
      articleId: a.article.id,
      articleTitle: a.article.title,
      dueDate: a.dueDate,
      instructions: a.instructions,
      status: mine?.status ?? AssignmentStatus.ASSIGNED,
      quizScore: mine?.quizScore ?? null,
      completedAt: mine?.completedAt ?? null,
    };
  });
  return mapped.sort((x, y) => {
    const dx = x.dueDate ? x.dueDate.getTime() : Number.POSITIVE_INFINITY;
    const dy = y.dueDate ? y.dueDate.getTime() : Number.POSITIVE_INFINITY;
    return dx - dy;
  });
}
