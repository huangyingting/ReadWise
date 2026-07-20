/**
 * Classroom and roster read queries.
 *
 * All functions here are read-only. Mutation commands live in
 * {@link ./commands}.
 */
import type { Classroom, ClassroomRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  readableArticleWhere,
  type ArticleAccessContext,
} from "@/lib/article-library/policy";

export type ClassroomMemberRow = {
  userId: string;
  role: ClassroomRole;
  name: string | null;
  email: string | null;
  image: string | null;
};

export type ClassroomStudentCandidateRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export type AssignableArticleOptionRow = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  difficulty: string | null;
};

export type AssignmentClassroomRow = {
  id: string;
  classroomId: string;
};

export type ClassroomAssignmentMetaRow = {
  assignmentId: string;
  dueDate: Date | null;
  instructions: string | null;
};

const NEWEST_FIRST = { createdAt: "desc" } as const;
const USER_PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;
const STUDENT_PICKER_LIMIT = 25;
const ARTICLE_PICKER_LIMIT = 25;

function classroomMembership(userId: string, role?: ClassroomRole) {
  return role ? { members: { some: { userId, role } } } : { members: { some: { userId } } };
}

export function getClassroom(classroomId: string): Promise<Classroom | null> {
  return prisma.classroom.findUnique({ where: { id: classroomId } });
}

export function getAssignmentClassroom(
  assignmentId: string,
): Promise<AssignmentClassroomRow | null> {
  return prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, classroomId: true },
  });
}

/**
 * Due date + instructions for every assignment in a classroom, keyed by
 * assignment id. The analytics `perAssignment` aggregate omits these editable
 * fields, so the teacher view merges this in for the overdue badge and the edit
 * form prefill.
 */
export async function listClassroomAssignmentMeta(
  classroomId: string,
): Promise<ClassroomAssignmentMetaRow[]> {
  const rows = await prisma.assignment.findMany({
    where: { classroomId },
    select: { id: true, dueDate: true, instructions: true },
  });
  return rows.map((r) => ({
    assignmentId: r.id,
    dueDate: r.dueDate,
    instructions: r.instructions,
  }));
}

/** Classrooms in an org, newest first. */
export function listClassroomsForOrg(orgId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: { orgId },
    orderBy: NEWEST_FIRST,
  });
}

/**
 * Classrooms a teacher leads — either as the primary `teacherId` or via a
 * Teacher ClassroomMembership. De-duplicated, newest first.
 */
export async function listClassroomsForTeacher(
  teacherId: string,
): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: {
      OR: [
        { teacherId },
        classroomMembership(teacherId, "Teacher"),
      ],
    },
    orderBy: NEWEST_FIRST,
  });
}

/** A student's classrooms (any role membership). */
export function listClassroomsForStudent(userId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: classroomMembership(userId),
    orderBy: NEWEST_FIRST,
  });
}

/** Roster of a classroom (teachers first, then students), joined with users. */
export async function listClassroomMembers(
  classroomId: string,
): Promise<ClassroomMemberRow[]> {
  const rows = await prisma.classroomMembership.findMany({
    where: { classroomId },
    include: { user: { select: USER_PROFILE_SELECT } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    name: r.user.name,
    email: r.user.email,
    image: r.user.image,
  }));
}

function buildStudentCandidateWhere(
  classroomId: string,
  query: string,
): Prisma.UserWhereInput {
  return {
    classroomMemberships: { none: { classroomId } },
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
          ],
        }
      : {}),
  };
}

export function searchClassroomStudentCandidates(
  classroomId: string,
  query = "",
  limit = STUDENT_PICKER_LIMIT,
): Promise<ClassroomStudentCandidateRow[]> {
  const trimmedQuery = query.trim();
  return prisma.user.findMany({
    where: buildStudentCandidateWhere(classroomId, trimmedQuery),
    select: USER_PROFILE_SELECT,
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: Math.max(1, Math.min(limit, STUDENT_PICKER_LIMIT)),
  });
}

export function searchAssignableArticleOptions(
  context: ArticleAccessContext,
  query = "",
  limit = ARTICLE_PICKER_LIMIT,
): Promise<AssignableArticleOptionRow[]> {
  const trimmedQuery = query.trim();
  return prisma.article.findMany({
    where: readableArticleWhere(context, {
      ...(trimmedQuery
        ? {
            OR: [
              { title: { contains: trimmedQuery } },
              { author: { contains: trimmedQuery } },
              { source: { contains: trimmedQuery } },
            ],
          }
        : {}),
    }),
    select: {
      id: true,
      title: true,
      author: true,
      source: true,
      difficulty: true,
    },
    orderBy: [{ title: "asc" }],
    take: Math.max(1, Math.min(limit, ARTICLE_PICKER_LIMIT)),
  });
}
