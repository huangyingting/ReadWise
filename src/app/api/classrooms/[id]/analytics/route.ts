import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { CAPABILITIES } from "@/lib/rbac";
import { getClassroom } from "@/lib/classroom";
import { getMembership, hasOrgCapability, isSystemAdmin } from "@/lib/org";
import {
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";

const CLASSROOM_NOT_FOUND = "Classroom not found";
const FORBIDDEN = "Forbidden";

function canViewAnalytics(
  viewerRole: Parameters<typeof isSystemAdmin>[0],
  isTeacher: boolean,
  isOrgAdmin: boolean,
): boolean {
  return isTeacher || isOrgAdmin || isSystemAdmin(viewerRole);
}

/**
 * Returns a classroom's analytics scoped to the caller's role (RW-061/063):
 *   - the classroom's teacher / a system admin → per-student detail;
 *   - an org admin → aggregate-only (individual rows redacted);
 *   - anyone else → 403 (learners read their own data via `/assignments`).
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const classroom = await getClassroom(params.id);
    if (!classroom) throw new ApiError(404, CLASSROOM_NOT_FOUND);

    const { user } = session;
    const membership = await getMembership(user.id, classroom.orgId);
    const isOrgAdmin = hasOrgCapability(membership, CAPABILITIES.orgManage);
    const isTeacher = classroom.teacherId === user.id;

    if (!canViewAnalytics(user.role, isTeacher, isOrgAdmin)) {
      throw new ApiError(403, FORBIDDEN);
    }

    const role = viewerRoleForClassroom({
      viewer: user,
      classroom,
      isOrgAdmin,
    });
    const analytics = await getClassroomAnalytics(params.id, role);
    if (!analytics) throw new ApiError(404, CLASSROOM_NOT_FOUND);

    return NextResponse.json({ role, analytics });
  },
);
