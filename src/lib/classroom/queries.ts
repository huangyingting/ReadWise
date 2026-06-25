/**
 * Classroom and roster read queries.
 *
 * All functions here are read-only. Mutation commands live in
 * {@link ./commands}.
 */
import type { Classroom, ClassroomRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ClassroomMemberRow = {
  userId: string;
  role: ClassroomRole;
  name: string | null;
  email: string | null;
  image: string | null;
};

export function getClassroom(classroomId: string): Promise<Classroom | null> {
  return prisma.classroom.findUnique({ where: { id: classroomId } });
}

/** Classrooms in an org, newest first. */
export function listClassroomsForOrg(orgId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
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
        { members: { some: { userId: teacherId, role: "Teacher" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** A student's classrooms (any role membership). */
export function listClassroomsForStudent(userId: string): Promise<Classroom[]> {
  return prisma.classroom.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Roster of a classroom (teachers first, then students), joined with users. */
export async function listClassroomMembers(
  classroomId: string,
): Promise<ClassroomMemberRow[]> {
  const rows = await prisma.classroomMembership.findMany({
    where: { classroomId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
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
