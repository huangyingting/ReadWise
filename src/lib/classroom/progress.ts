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
  feedback: string | null;
};
export type ClassroomProgressData = {
  classroom: { id: string; name: string; orgId: string; teacherId: string };
  students: ClassroomProgressStudent[];
  assignments: ClassroomProgressAssignment[];
  completions: ClassroomProgressCompletion[];
};

type ClassroomMemberRow = {
  userId: string;
  user: { name: string | null; email: string | null };
};

type ClassroomAssignmentRow = {
  id: string;
  articleId: string;
  article: { title: string };
  dueDate: Date | null;
  createdAt: Date;
};

function toProgressStudent(member: ClassroomMemberRow): ClassroomProgressStudent {
  return {
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
  };
}

function toProgressAssignment(
  assignment: ClassroomAssignmentRow,
): ClassroomProgressAssignment {
  return {
    id: assignment.id,
    articleId: assignment.articleId,
    articleTitle: assignment.article.title,
    dueDate: assignment.dueDate,
    createdAt: assignment.createdAt,
  };
}

function toProgressCompletion(
  completion: ClassroomProgressCompletion,
): ClassroomProgressCompletion {
  return {
    assignmentId: completion.assignmentId,
    studentId: completion.studentId,
    status: completion.status,
    quizScore: completion.quizScore,
    completedAt: completion.completedAt,
    feedback: completion.feedback,
  };
}

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
        feedback: true,
      },
    }),
  ]);

  return {
    classroom,
    students: memberRows.map(toProgressStudent),
    assignments: assignmentRows.map(toProgressAssignment),
    completions: completionRows.map(toProgressCompletion),
  };
}
