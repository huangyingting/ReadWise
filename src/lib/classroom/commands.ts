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
export type UpdateClassroomLifecycleInput = {
  name?: string;
  archived?: boolean;
};
export type UpdateClassroomLifecycleResult =
  | { ok: true; classroom: Classroom; changed: { name: boolean; archived: boolean } }
  | { ok: false; status: 400; reason: "empty_update" };
export type DeleteClassroomResult =
  | { ok: true; deleted: boolean }
  | {
      ok: false;
      status: 409;
      reason: "classroom_not_empty";
      assignmentCount: number;
      memberCount: number;
    };

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

export async function updateClassroomLifecycle(
  classroomId: string,
  input: UpdateClassroomLifecycleInput,
  now: Date = new Date(),
): Promise<UpdateClassroomLifecycleResult> {
  const data: { name?: string; archivedAt?: Date | null } = {};
  if (input.name !== undefined) {
    data.name = input.name.trim();
  }
  if (input.archived !== undefined) {
    data.archivedAt = input.archived ? now : null;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, reason: "empty_update" };
  }

  const classroom = await prisma.classroom.update({
    where: { id: classroomId },
    data,
  });
  return {
    ok: true,
    classroom,
    changed: {
      name: input.name !== undefined,
      archived: input.archived !== undefined,
    },
  };
}

/**
 * Hard-deletes an empty classroom. "Empty" allows the primary teacher's own
 * membership row, but blocks deletion when assignments or other roster members
 * exist so learner progress is not silently erased.
 */
export async function deleteClassroom(classroomId: string): Promise<DeleteClassroomResult> {
  return prisma.$transaction(async (tx) => {
    const classroom = await tx.classroom.findUnique({
      where: { id: classroomId },
      select: { id: true, teacherId: true },
    });
    if (!classroom) {
      return { ok: true, deleted: false };
    }

    const assignmentCount = await tx.assignment.count({ where: { classroomId } });
    const memberCount = await tx.classroomMembership.count({
      where: { classroomId, NOT: { userId: classroom.teacherId } },
    });
    if (assignmentCount > 0 || memberCount > 0) {
      return {
        ok: false,
        status: 409,
        reason: "classroom_not_empty",
        assignmentCount,
        memberCount,
      };
    }

    await tx.classroom.delete({ where: { id: classroomId } });
    return { ok: true, deleted: true };
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
