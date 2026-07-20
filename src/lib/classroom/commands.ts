/**
 * Classroom, roster, and assignment mutation commands.
 *
 * All write operations for classrooms, roster membership, and article
 * assignments live here. Teachers are seated as classroom members inside
 * {@link createClassroom}'s transaction.
 */
import type { Assignment, Classroom, ClassroomMembership, ClassroomRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseOptionalDueDate, trimOrNull } from "./article-assignments";

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

export type UpdateAssignmentInput = {
  dueDate?: string;
  instructions?: string | null;
};

export type UpdateAssignmentResult =
  | { ok: true; assignment: Assignment }
  | { ok: false; status: 400; reason: "invalid_due_date" };

/**
 * Updates an assignment's due date and/or instructions. Only the fields present
 * in `input` are changed. A provided due date must parse to a real date (mirrors
 * {@link createArticleAssignment}); instructions are trimmed (empty → null).
 */
export async function updateAssignment(
  assignmentId: string,
  input: UpdateAssignmentInput,
): Promise<UpdateAssignmentResult> {
  const data: { dueDate?: Date | null; instructions?: string | null } = {};

  if (input.dueDate !== undefined) {
    const dueDate = parseOptionalDueDate(input.dueDate);
    if (input.dueDate && !dueDate) {
      return { ok: false, status: 400, reason: "invalid_due_date" };
    }
    data.dueDate = dueDate;
  }

  if (input.instructions !== undefined) {
    data.instructions = trimOrNull(input.instructions);
  }

  const assignment = await prisma.assignment.update({
    where: { id: assignmentId },
    data,
  });
  return { ok: true, assignment };
}
