/**
 * Raw classroom progress data for tenant analytics.
 *
 * Fetches the roster × assignment × completion matrix that the analytics layer
 * aggregates. This is a read model — it does not enforce authorization. Callers
 * (e.g. `@/lib/analytics/tenant`) must verify the viewer's access before
 * calling into this module.
 */
import { AssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ClassroomProgressStudent = { userId: string; name: string | null; email: string | null };
export type ClassroomProgressAssignment = {
  id: string;
  articleId: string;
  articleTitle: string;
  dueDate: Date | null;
  createdAt: Date;
};
export type ClassroomProgressCompletion = {
  assignmentId: string;
  studentId: string;
  status: AssignmentStatus;
  quizScore: number | null;
  completedAt: Date | null;
};
export type ClassroomProgressData = {
  classroom: { id: string; name: string; orgId: string; teacherId: string };
  students: ClassroomProgressStudent[];
  assignments: ClassroomProgressAssignment[];
  completions: ClassroomProgressCompletion[];
};

/**
 * Fetches the raw matrix the class-progress / analytics layer aggregates over:
 * the roster's STUDENTS, the classroom's assignments, and every student
 * completion. Returns null when the classroom doesn't exist.
 */
export async function getClassroomProgressData(
  classroomId: string,
): Promise<ClassroomProgressData | null> {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, name: true, orgId: true, teacherId: true },
  });
  if (!classroom) return null;

  const [memberRows, assignmentRows, completionRows] = await Promise.all([
    prisma.classroomMembership.findMany({
      where: { classroomId, role: "Student" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.assignment.findMany({
      where: { classroomId },
      include: { article: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.assignmentCompletion.findMany({
      where: { assignment: { classroomId } },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        quizScore: true,
        completedAt: true,
      },
    }),
  ]);

  return {
    classroom,
    students: memberRows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
    })),
    assignments: assignmentRows.map((a) => ({
      id: a.id,
      articleId: a.articleId,
      articleTitle: a.article.title,
      dueDate: a.dueDate,
      createdAt: a.createdAt,
    })),
    completions: completionRows.map((c) => ({
      assignmentId: c.assignmentId,
      studentId: c.studentId,
      status: c.status,
      quizScore: c.quizScore,
      completedAt: c.completedAt,
    })),
  };
}
