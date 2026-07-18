/**
 * Classroom, roster, and assignment mutation commands.
 *
 * All write operations for classrooms, roster membership, and article
 * assignments live here. Teachers are seated as classroom members inside
 * {@link createClassroom}'s transaction.
 */
import type { Classroom, ClassroomMembership, ClassroomRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CreateClassroomInput = { orgId: string; name: string; teacherId: string };

function teacherMembership(classroomId: string, teacherId: string) {
  return { classroomId, userId: teacherId, role: "Teacher" as const };
}

/**
 * Creates a classroom and seats its primary teacher as a Teacher member, in one
 * transaction.
 */
export async function createClassroom(
  input: CreateClassroomInput,
): Promise<Classroom> {
  return prisma.$transaction(async (tx) => {
    const classroom = await tx.classroom.create({
      data: { orgId: input.orgId, name: input.name.trim(), teacherId: input.teacherId },
    });
    await tx.classroomMembership.create({
      data: teacherMembership(classroom.id, input.teacherId),
    });
    return classroom;
  });
}

/** Adds (or re-roles) a member of a classroom. Idempotent via the unique key. */
export function addClassroomMember(
  classroomId: string,
  userId: string,
  role: ClassroomRole = "Student",
): Promise<ClassroomMembership> {
  return prisma.classroomMembership.upsert({
    where: { classroomId_userId: { classroomId, userId } },
    update: { role },
    create: { classroomId, userId, role },
  });
}

/** Removes a member from a classroom. */
export async function removeClassroomMember(
  classroomId: string,
  userId: string,
): Promise<void> {
  await prisma.classroomMembership.deleteMany({ where: { classroomId, userId } });
}

/** Deletes an assignment (cascades its completions). */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  await prisma.assignment.deleteMany({ where: { id: assignmentId } });
}
