import type { Prisma } from "@prisma/client";

/**
 * Prisma where-fragment: an assignment is visible to `studentId` when it has NO
 * targets (whole-classroom, the default) OR has a target row for this student.
 * Combine as a sibling key of an existing `classroom` filter (Prisma ANDs top-level keys).
 */
export function assignmentVisibleToStudentWhere(studentId: string): Prisma.AssignmentWhereInput {
  return { OR: [{ targets: { none: {} } }, { targets: { some: { studentId } } }] };
}

/**
 * In-memory audience resolver. `targetedIds` null OR empty ⇒ the whole enrolled
 * roster (backward-compatible). Otherwise the targeted subset intersected with
 * the enrolled roster (a target for an un-enrolled/removed student is ignored).
 */
export function effectiveStudentIds(
  enrolledIds: string[],
  targetedIds: string[] | null | undefined,
): string[] {
  if (!targetedIds || targetedIds.length === 0) return enrolledIds;
  const enrolled = new Set(enrolledIds);
  return targetedIds.filter((id) => enrolled.has(id));
}
