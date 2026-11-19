/**
 * Assignment access shared by the classroom tools (annotations, activities,
 * writing): who manages an assignment, which live assignments a learner may
 * respond to, and the id-only audit row for teacher changes.
 *
 * Managed access is decided in one order everywhere — missing assignment 404,
 * non-manager 403, archived classroom 409 for writes — so the tools agree.
 */
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  recordAuditFromRequest,
  type AuditAction,
  type AuditRequestInput,
} from "@/lib/security/audit";
import { canManageClassroom } from "./guards";
import { managedClassroomScope } from "./educator";
import { assignmentLiveWhere, assignmentVisibleToStudentWhere } from "./targeting";

export type Viewer = { id: string; role?: string | null };

/** Builds the request-bound audit entry for a teacher change (ids only). */
export type AssignmentAuditFactory = (entry: {
  action: AuditAction;
  targetId: string;
  metadata: Record<string, unknown>;
}) => AuditRequestInput;

export type ManagedAccessFailure =
  | { ok: false; status: 403; reason: "forbidden" }
  | { ok: false; status: 404; reason: "not_found" }
  | { ok: false; status: 409; reason: "archived" };

export const NOT_FOUND = { ok: false, status: 404, reason: "not_found" } as const;
export const FORBIDDEN = { ok: false, status: 403, reason: "forbidden" } as const;
const ARCHIVED = { ok: false, status: 409, reason: "archived" } as const;

const MAX_TEACHING_ASSIGNMENTS = 50;

const ASSIGNMENT_ACCESS_SELECT = {
  id: true,
  articleId: true,
  writePrompt: true,
  article: { select: { title: true } },
  classroom: { select: { id: true, name: true, orgId: true, teacherId: true, archivedAt: true } },
} as const;

async function membershipRole(userId: string, orgId: string) {
  return prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { role: true },
  }) as Promise<{ role: MembershipRole } | null>;
}

/** Loads an assignment and whether the viewer manages its classroom. */
export async function assignmentAccess(assignmentId: string, viewer: Viewer) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: ASSIGNMENT_ACCESS_SELECT,
  });
  if (!assignment) return null;
  const membership = await membershipRole(viewer.id, assignment.classroom.orgId);
  return { assignment, manages: canManageClassroom(viewer, assignment.classroom, membership) };
}

export type ManagedAssignment = NonNullable<Awaited<ReturnType<typeof assignmentAccess>>>["assignment"];

/**
 * The assignment when the viewer manages its classroom. `forWrite` also
 * refuses archived classrooms, which are read-only.
 */
export async function requireManagedAssignment(
  viewer: Viewer,
  assignmentId: string,
  { forWrite }: { forWrite: boolean },
): Promise<{ ok: true; assignment: ManagedAssignment } | ManagedAccessFailure> {
  const access = await assignmentAccess(assignmentId, viewer);
  if (!access) return NOT_FOUND;
  if (!access.manages) return FORBIDDEN;
  if (forWrite && access.assignment.classroom.archivedAt) return ARCHIVED;
  return { ok: true, assignment: access.assignment };
}

/** Records a teacher change in the same transaction, with ids only. */
export async function recordAssignmentAudit(
  factory: AssignmentAuditFactory,
  action: AuditAction,
  targetId: string,
  assignment: { id: string; classroom: { id: string } },
  tx: Parameters<typeof recordAuditFromRequest>[1],
): Promise<void> {
  await recordAuditFromRequest(
    factory({ action, targetId, metadata: { assignmentId: assignment.id, classroomId: assignment.classroom.id } }),
    tx,
  );
}

/** Live assignments the learner is enrolled in as a student (targeting applies). */
export function learnerAssignmentsWhere(userId: string) {
  return {
    classroom: { archivedAt: null, members: { some: { userId, role: "Student" as const } } },
    AND: [assignmentVisibleToStudentWhere(userId), assignmentLiveWhere(new Date())],
  };
}

/** Live-or-not assignments of an article in active classrooms the viewer manages. */
export async function teachingAssignments(viewer: Viewer, articleId: string) {
  const { memberships, where } = await managedClassroomScope(viewer);
  const rows = await prisma.assignment.findMany({
    where: { articleId, classroom: where },
    select: { id: true, classroom: { select: { name: true, orgId: true, teacherId: true } } },
    orderBy: { createdAt: "asc" },
    take: MAX_TEACHING_ASSIGNMENTS,
  });
  return rows
    .filter((row) =>
      canManageClassroom(viewer, row.classroom, memberships.find((m) => m.orgId === row.classroom.orgId) ?? null),
    )
    .map((row) => ({ assignmentId: row.id, classroomName: row.classroom.name }));
}
