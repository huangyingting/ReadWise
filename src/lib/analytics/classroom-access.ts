import { ApiError } from "@/lib/errors/api-error";
import { getClassroom } from "@/lib/classroom";
import { getMembership, hasOrgCapability, isSystemAdmin } from "@/lib/org";
import { CAPABILITIES } from "@/lib/rbac";
import {
  type ClassroomAnalyticsFilters,
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";

const CLASSROOM_NOT_FOUND = "Classroom not found";
const FORBIDDEN = "Forbidden";

type Viewer = {
  id: string;
  role?: string | null;
};

export function parseClassroomAnalyticsFilters(
  params: URLSearchParams,
): ClassroomAnalyticsFilters {
  return {
    assignmentId: params.get("assignmentId")?.trim() || undefined,
    studentId: params.get("studentId")?.trim() || undefined,
  };
}

function canViewAnalytics(
  viewerRole: Parameters<typeof isSystemAdmin>[0],
  isTeacher: boolean,
  isOrgAdmin: boolean,
): boolean {
  return isTeacher || isOrgAdmin || isSystemAdmin(viewerRole);
}

export async function getScopedClassroomAnalytics({
  classroomId,
  viewer,
  filters = {},
}: {
  classroomId: string;
  viewer: Viewer;
  filters?: ClassroomAnalyticsFilters;
}) {
  const classroom = await getClassroom(classroomId);
  if (!classroom) throw new ApiError(404, CLASSROOM_NOT_FOUND);

  const membership = await getMembership(viewer.id, classroom.orgId);
  const isOrgAdmin = hasOrgCapability(membership, CAPABILITIES.orgManage);
  const isTeacher = classroom.teacherId === viewer.id;

  if (!canViewAnalytics(viewer.role, isTeacher, isOrgAdmin)) {
    throw new ApiError(403, FORBIDDEN);
  }

  const role = viewerRoleForClassroom({
    viewer,
    classroom,
    isOrgAdmin,
  });
  const analytics = await getClassroomAnalytics(classroomId, role, filters);
  if (!analytics) throw new ApiError(404, CLASSROOM_NOT_FOUND);

  return { role, analytics, classroom };
}
