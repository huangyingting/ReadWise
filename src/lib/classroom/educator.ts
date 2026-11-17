/**
 * Educator detection (#1304, shared with #1306 answer keys): teachers (a
 * membership granting `classroom.manage` in any organization), content staff
 * (`articles.manage`), and platform super-users.
 */
import { prisma } from "@/lib/prisma";
import { CAPABILITIES, MEMBERSHIP_ROLES, membershipHasCapability, roleHasCapability } from "@/lib/rbac";
import { canManageClassroom } from "./guards";

const TEACHING_MEMBERSHIP_ROLES = MEMBERSHIP_ROLES.filter((role) =>
  membershipHasCapability(role, CAPABILITIES.classroomManage),
);

/** True for teachers, content staff, and platform super-users. */
export async function isEducator(user: { id: string; role?: string | null }): Promise<boolean> {
  if (
    roleHasCapability(user.role, CAPABILITIES.articlesManage) ||
    roleHasCapability(user.role, CAPABILITIES.platformSuperuser)
  ) {
    return true;
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, role: { in: [...TEACHING_MEMBERSHIP_ROLES] } },
    select: { id: true },
  });
  return membership !== null;
}

const MAX_MANAGED_CLASSROOMS = 50;

/** Active classrooms the viewer manages (for the reader's quick assign), by name. */
export async function listManagedClassrooms(viewer: { id: string; role?: string | null }): Promise<Array<{ id: string; name: string }>> {
  const memberships = await prisma.membership.findMany({ where: { userId: viewer.id }, select: { orgId: true, role: true } });
  const classrooms = await prisma.classroom.findMany({
    where: {
      archivedAt: null,
      OR: [{ teacherId: viewer.id }, { orgId: { in: memberships.map((membership) => membership.orgId) } }],
    },
    select: { id: true, name: true, orgId: true, teacherId: true },
    orderBy: { name: "asc" },
    take: MAX_MANAGED_CLASSROOMS,
  });
  return classrooms
    .filter((classroom) =>
      canManageClassroom(viewer, classroom, memberships.find((membership) => membership.orgId === classroom.orgId) ?? null),
    )
    .map(({ id, name }) => ({ id, name }));
}
