/**
 * Classroom and roster read queries.
 *
 * All functions here are read-only. Mutation commands live in
 * {@link ./commands}.
 */
import type { Classroom, ClassroomRole, Prisma } from "@prisma/client";
import { AssignmentStatus } from "@prisma/client";
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
const ACTIVE_CLASSROOM_WHERE = { archivedAt: null } as const;
const ARCHIVED_CLASSROOM_WHERE = { archivedAt: { not: null } } as const;
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
    where: { orgId, ...ACTIVE_CLASSROOM_WHERE },
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
      ...ACTIVE_CLASSROOM_WHERE,
      OR: [
        { teacherId },
        classroomMembership(teacherId, "Teacher"),
      ],
    },
    orderBy: NEWEST_FIRST,
  });
}

/**
 * Archived classrooms a teacher leads — same teacher scoping as
 * listClassroomsForTeacher, but restricted to archived rows for recovery UI.
 */
export function listArchivedClassroomsForTeacher(
  teacherId: string,
): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: {
      ...ARCHIVED_CLASSROOM_WHERE,
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
    where: { ...classroomMembership(userId), ...ACTIVE_CLASSROOM_WHERE },
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
  orgId: string,
  query: string,
): Prisma.UserWhereInput {
  return {
    memberships: { some: { orgId } },
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
  orgId: string,
  query = "",
  limit = STUDENT_PICKER_LIMIT,
): Promise<ClassroomStudentCandidateRow[]> {
  const trimmedQuery = query.trim();
  return prisma.user.findMany({
    where: buildStudentCandidateWhere(classroomId, orgId, trimmedQuery),
    select: USER_PROFILE_SELECT,
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: Math.max(1, Math.min(limit, STUDENT_PICKER_LIMIT)),
  });
}

/**
 * Count of pending (not-yet-completed) assignments for a student across all
 * their enrolled, non-archived classrooms. An assignment is pending when the
 * student has no COMPLETED completion row — covers both the ASSIGNED default
 * and any IN_PROGRESS row. Mirrors the visibility filter used by
 * {@link listAssignmentsForStudent} in student-reads.ts.
 *
 * Server-only (uses prisma directly). Intended for the RSC layout badge only.
 */
export function countPendingAssignmentsForStudent(studentId: string): Promise<number> {
  return prisma.assignment.count({
    where: {
      classroom: { archivedAt: null, members: { some: { userId: studentId } } },
      NOT: { completions: { some: { studentId, status: AssignmentStatus.COMPLETED } } },
    },
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
