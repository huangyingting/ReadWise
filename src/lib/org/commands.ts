/**
 * Organization and membership mutation commands.
 *
 * All write operations live here. Last-admin guards are enforced at this layer
 * to prevent a tenant from accidentally losing its only administrator. Commands
 * return {@link DomainResult} so callers can act on failures without catching
 * exceptions.
 */
import type { MembershipRole, Organization, Membership, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type DomainResult, ok, notFound, conflict } from "@/lib/result";
import { getMembership } from "./queries";
import { slugifyOrg, ensureUniqueOrgSlug } from "./slugs";

export type CreateOrganizationInput = {
  name: string;
  slug?: string;
  settings?: Record<string, unknown> | null;
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
        settings:
          input.settings == null
            ? undefined
            : (input.settings as Prisma.InputJsonValue),
      },
    });
    const membership = await tx.membership.create({
      data: { orgId: organization.id, userId: creatorUserId, role: "OrgAdmin" },
    });
    return { organization, membership };
  });
}

/**
 * Adds (or re-roles) a user in an org. Idempotent via the `userId_orgId` unique
 * key: an existing membership is updated to `role`, otherwise one is created.
 */
export async function addMember(
  orgId: string,
  userId: string,
  role: MembershipRole = "Member",
): Promise<Membership> {
  return prisma.membership.upsert({
    where: { userId_orgId: { userId, orgId } },
    update: { role },
    create: { orgId, userId, role },
  });
}

/** Count of OrgAdmins in an org — used to enforce the last-admin rule. */
function countOrgAdmins(orgId: string): Promise<number> {
  return prisma.membership.count({ where: { orgId, role: "OrgAdmin" } });
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
  const membership = await getMembership(userId, orgId);
  if (!membership) return notFound("Membership not found");
  if (membership.role === "OrgAdmin" && role !== "OrgAdmin") {
    const admins = await countOrgAdmins(orgId);
    if (admins <= 1) {
      return conflict("Cannot demote the last organization admin");
    }
  }
  await prisma.membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: { role },
  });
  return ok({ role });
}

/** Removes a member, refusing to remove the LAST OrgAdmin. */
export async function removeMember(
  orgId: string,
  userId: string,
): Promise<DomainResult> {
  const membership = await getMembership(userId, orgId);
  if (!membership) return notFound("Membership not found");
  if (membership.role === "OrgAdmin") {
    const admins = await countOrgAdmins(orgId);
    if (admins <= 1) {
      return conflict("Cannot remove the last organization admin");
    }
  }
  await prisma.membership.delete({ where: { userId_orgId: { userId, orgId } } });
  return ok();
}
