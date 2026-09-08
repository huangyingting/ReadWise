/**
 * Organization and membership mutation commands.
 *
 * All write operations live here. Last-admin guards are enforced at this layer
 * to prevent a tenant from accidentally losing its only administrator. Commands
 * return {@link DomainResult} so callers can act on failures without catching
 * exceptions.
 */
import type { MembershipRole, Organization, Membership } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { type DomainResult, ok, notFound, conflict } from "@/lib/result";
import { slugifyOrg, ensureUniqueOrgSlug } from "./slugs";

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
};

/**
 * Creates an organization and makes `creatorUserId` its first OrgAdmin, in one
 * transaction. The slug is derived from the name when not supplied and made
 * unique. Returns the new org plus the creator's membership.
 */
export async function createOrganization(
  input: CreateOrganizationInput,
  creatorUserId: string,
): Promise<{ organization: Organization; membership: Membership }> {
  const name = input.name.trim();
  const slug = await ensureUniqueOrgSlug(
    input.slug ? slugifyOrg(input.slug) : slugifyOrg(name),
  );
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name,
        slug,
      },
    });
    const membership = await tx.membership.create({
      data: { orgId: organization.id, userId: creatorUserId, role: "OrgAdmin" },
    });
    return { organization, membership };
  });
}

/** Adds a new user membership in an org. Existing memberships must be re-roled through updateMemberRole. */
export async function addMember(
  orgId: string,
  userId: string,
  role: MembershipRole = "Member",
): Promise<Membership> {
  return prisma.membership.create({ data: { orgId, userId, role } });
}

/**
 * Updates a member's role, refusing to demote the LAST OrgAdmin (a tenant must
 * always retain at least one administrator).
 */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<DomainResult<{ role: MembershipRole }>> {
  return runSerializableTransaction(async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership) return notFound("Membership not found");
    if (membership.role === role) return ok({ role });
    if (membership.role === "OrgAdmin" && role !== "OrgAdmin") {
      const adminCount = await tx.membership.count({
        where: { orgId, role: "OrgAdmin" },
      });
      if (adminCount <= 1) {
        return conflict("Cannot demote the last organization admin");
      }
    }
    await tx.membership.update({
      where: { userId_orgId: { userId, orgId } },
      data: { role },
    });
    return ok({ role });
  });
}

/** Removes a member, refusing to remove the LAST OrgAdmin. */
export async function removeMember(
  orgId: string,
  userId: string,
): Promise<DomainResult> {
  return runSerializableTransaction(async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership) return notFound("Membership not found");
    if (membership.role === "OrgAdmin") {
      const adminCount = await tx.membership.count({
        where: { orgId, role: "OrgAdmin" },
      });
      if (adminCount <= 1) {
        return conflict("Cannot remove the last organization admin");
      }
    }

    const ownedClassroom = await tx.classroom.findFirst({
      where: { orgId, teacherId: userId },
      select: { id: true },
    });
    if (ownedClassroom) {
      return conflict("Transfer owned classrooms before removing this member");
    }

    await tx.assignmentTarget.deleteMany({
      where: { studentId: userId, assignment: { classroom: { orgId } } },
    });
    await tx.classroomMembership.deleteMany({
      where: { userId, classroom: { orgId } },
    });
    await tx.membership.delete({
      where: { userId_orgId: { userId, orgId } },
    });
    return ok();
  });
}
