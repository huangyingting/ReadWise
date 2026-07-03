/**
 * Organization and membership read queries.
 *
 * All functions here are read-only and import only the Prisma singleton.
 * Mutation commands live in {@link ./commands}.
 */
import type { Organization, Membership } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A membership joined with its organization (for "my orgs" listings). */
export type MembershipWithOrg = Membership & { org: Organization };

const NEWEST_MEMBERSHIP_FIRST = { createdAt: "desc" as const };
const ORG_MEMBER_ORDER = [{ role: "asc" as const }, { createdAt: "asc" as const }];
const MEMBER_USER_SELECT = { id: true, name: true, email: true, image: true } as const;

function membershipKey(userId: string, orgId: string) {
  return { userId_orgId: { userId, orgId } };
}

export function getOrganization(orgId: string): Promise<Organization | null> {
  return prisma.organization.findUnique({ where: { id: orgId } });
}

export function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  return prisma.organization.findUnique({ where: { slug } });
}

/** The user's membership in a specific org (or null if not a member). */
export function getMembership(
  userId: string,
  orgId: string,
): Promise<Membership | null> {
  return prisma.membership.findUnique({
    where: membershipKey(userId, orgId),
  });
}

/** All orgs a user belongs to, with the org joined, newest membership first. */
export function listUserOrganizations(
  userId: string,
): Promise<MembershipWithOrg[]> {
  return prisma.membership.findMany({
    where: { userId },
    include: { org: true },
    orderBy: NEWEST_MEMBERSHIP_FIRST,
  });
}

/** All members of an org with their user joined, OrgAdmins first then newest. */
export function listOrgMembers(orgId: string) {
  return prisma.membership.findMany({
    where: { orgId },
    include: { user: { select: MEMBER_USER_SELECT } },
    orderBy: ORG_MEMBER_ORDER,
  });
}
