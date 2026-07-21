/**
 * Single-organization detail for the admin back-office (#1163).
 *
 * Returns one org plus its memberships (with the user's name/email + role) and
 * its classrooms (with the teacher and per-classroom assignment count), or null
 * when the org does not exist. Read-only; imports only the Prisma singleton.
 *
 * Privacy: member emails/names are returned for display to an AUTHORIZED admin
 * only. Callers must never log this shape.
 */
import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AdminOrgMemberRow = {
  userId: string;
  role: MembershipRole;
  name: string | null;
  email: string | null;
  image: string | null;
  joinedAt: Date;
};

export type AdminOrgClassroomRow = {
  id: string;
  name: string;
  createdAt: Date;
  teacherName: string | null;
  teacherEmail: string | null;
  assignmentCount: number;
};

export type AdminOrganizationDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  classroomCount: number;
  members: AdminOrgMemberRow[];
  classrooms: AdminOrgClassroomRow[];
};

/**
 * Loads full detail for a single organization, or null if it does not exist.
 * OrgAdmins are listed first, then newest members; classrooms are newest first.
 */
export async function getOrganizationDetail(
  orgId: string,
): Promise<AdminOrganizationDetail | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      _count: { select: { memberships: true } },
      memberships: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
      classrooms: {
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          teacher: { select: { name: true, email: true } },
          _count: { select: { assignments: true } },
        },
      },
    },
  });

  if (!org) return null;

  const members: AdminOrgMemberRow[] = org.memberships.map((m) => ({
    userId: m.userId,
    role: m.role as MembershipRole,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    joinedAt: m.createdAt,
  }));

  const classrooms: AdminOrgClassroomRow[] = org.classrooms.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    teacherName: c.teacher.name,
    teacherEmail: c.teacher.email,
    assignmentCount: c._count.assignments,
  }));

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    memberCount: org._count.memberships,
    classroomCount: classrooms.length,
    members,
    classrooms,
  };
}
