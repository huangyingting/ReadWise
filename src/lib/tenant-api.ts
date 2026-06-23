/**
 * Route-handler authorization helpers for tenant features (RW-060/061).
 *
 * Page guards in `@/lib/org` use `redirect()`; these are their API-route twins:
 * they THROW {@link ApiError} (caught + formatted by the shared api-handler) so
 * routes built with `createHandler` can enforce per-org / per-classroom
 * authorization without hand-rolling 401/403/404 responses. A global system
 * admin is always treated as a super-user (defense-in-depth), mirroring the page
 * guards.
 */
import type { Session } from "next-auth";
import type { Membership, Classroom } from "@prisma/client";
import { ApiError } from "@/lib/api-handler";
import type { Capability } from "@/lib/rbac";
import {
  getMembership,
  hasOrgCapability,
  isSystemAdmin,
} from "@/lib/org";
import { canManageClassroom, getClassroom } from "@/lib/classroom";

/**
 * Requires the session to hold `capability` within `orgId` (via its membership)
 * or be a system admin. Returns the membership (null only for a system-admin
 * super-user with no row). Throws 403 otherwise.
 */
export async function requireOrgCapabilityApi(
  session: Session,
  orgId: string,
  capability: Capability,
): Promise<Membership | null> {
  const membership = await getMembership(session.user.id, orgId);
  if (isSystemAdmin(session.user.role)) return membership;
  if (!hasOrgCapability(membership, capability)) {
    throw new ApiError(403, "Forbidden");
  }
  return membership;
}

/**
 * Requires the session to be able to MANAGE a classroom (its teacher, the org's
 * admin, or a system admin). Loads the classroom (404 if missing) and the
 * viewer's membership, then enforces {@link canManageClassroom} (403).
 */
export async function requireClassroomManageApi(
  session: Session,
  classroomId: string,
): Promise<{ classroom: Classroom; membership: Membership | null }> {
  const classroom = await getClassroom(classroomId);
  if (!classroom) throw new ApiError(404, "Classroom not found");
  const membership = await getMembership(session.user.id, classroom.orgId);
  if (!canManageClassroom(session.user, classroom, membership)) {
    throw new ApiError(403, "Forbidden");
  }
  return { classroom, membership };
}
