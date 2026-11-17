import { ApiError } from "@/lib/errors/api-error";
import { getClassroom } from "@/lib/classroom/queries";
import { getMembership } from "@/lib/org/queries";
import { hasOrgCapability, isSystemAdmin } from "@/lib/org/guards";
import { CAPABILITIES } from "@/lib/rbac";
import {
  type ClassroomAnalyticsFilters,
  analyticsAccessFor,
  getClassroomAnalytics,
  viewerRoleForClassroom,
} from "@/lib/analytics/tenant";
import { getClassroomSkillMatrix } from "@/lib/classroom/skills";

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

/**
 * Resolves the viewer's analytics role for a classroom (404 when missing, 403
 * unless teacher, org admin, or system admin). Shared by the analytics and
 * reading-skills views so they enforce the same visibility rules.
 */
async function resolveClassroomAnalyticsRole(classroomId: string, viewer: Viewer) {
  const classroom = await getClassroom(classroomId);
  if (!classroom) throw new ApiError(404, CLASSROOM_NOT_FOUND);

  const membership = await getMembership(viewer.id, classroom.orgId);
  const isOrgAdmin = hasOrgCapability(membership, CAPABILITIES.orgManage);
  const isTeacher =
    classroom.teacherId === viewer.id &&
    hasOrgCapability(membership, CAPABILITIES.classroomManage);

  if (!canViewAnalytics(viewer.role, isTeacher, isOrgAdmin)) {
    throw new ApiError(403, FORBIDDEN);
  }

  const role = viewerRoleForClassroom({
    viewer,
    classroom,
    isTeacher,
    isOrgAdmin,
  });
  return { classroom, role };
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
  const { classroom, role } = await resolveClassroomAnalyticsRole(classroomId, viewer);
  if (
    (filters.studentId || filters.assignmentId) &&
    role !== "teacher" &&
    role !== "systemAdmin"
  ) {
    throw new ApiError(403, "Analytics filtering requires individual data access");
  }
  const analytics = await getClassroomAnalytics(classroomId, role, filters);
  if (!analytics) throw new ApiError(404, CLASSROOM_NOT_FOUND);

  return { role, analytics, classroom };
}

/**
 * Classroom reading-skills matrix (#1302) under the analytics visibility
 * rules: teachers and system admins see per-student rows; org admins get
 * class totals only.
 */
export async function getScopedClassroomSkills({
  classroomId,
  viewer,
}: {
  classroomId: string;
  viewer: Viewer;
}) {
  const { classroom, role } = await resolveClassroomAnalyticsRole(classroomId, viewer);
  const matrix = await getClassroomSkillMatrix(classroomId, {
    individual: analyticsAccessFor(role).individualData,
  });
  return { role, matrix, classroom };
}
