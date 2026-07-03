/**
 * Classroom authorization helpers.
 *
 * Determines whether a viewer may create or manage classrooms based on their
 * global role and org-level membership capabilities. These are pure boolean
 * guards — they do not throw or redirect. Use them inside page components and
 * API routes that have already resolved the viewer's session and membership.
 */
import type { MembershipRole } from "@prisma/client";
import { CAPABILITIES } from "@/lib/rbac";
import { hasOrgCapability, isSystemAdmin } from "@/lib/org/guards";

export type ClassroomViewer = { id?: string | null; role?: string | null } | null | undefined;
type ClassroomOwnership = { teacherId: string; orgId: string } | null | undefined;
type OrgMembership = { role: MembershipRole } | null | undefined;

function hasSystemAdminAccess(viewer: ClassroomViewer): boolean {
  return isSystemAdmin(viewer?.role);
}

function isClassroomTeacher(
  viewer: ClassroomViewer,
  classroom: ClassroomOwnership,
): boolean {
  return Boolean(viewer?.id && classroom && classroom.teacherId === viewer.id);
}

/** True if the viewer may create classrooms in an org (OrgAdmin or Teacher). */
export function canCreateClassroom(
  viewer: ClassroomViewer,
  membership: OrgMembership,
): boolean {
  if (hasSystemAdminAccess(viewer)) return true;
  return hasOrgCapability(membership, CAPABILITIES.classroomManage);
}

/**
 * True if the viewer may MANAGE a classroom (edit roster, assign, view full
 * progress): a system admin, the org's admin, or the classroom's own teacher.
 */
export function canManageClassroom(
  viewer: ClassroomViewer,
  classroom: ClassroomOwnership,
  membership: OrgMembership,
): boolean {
  if (!classroom) return false;
  if (hasSystemAdminAccess(viewer)) return true;
  if (isClassroomTeacher(viewer, classroom)) return true;
  return hasOrgCapability(membership, CAPABILITIES.orgManage);
}
