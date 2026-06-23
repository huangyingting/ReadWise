/**
 * Organizations & memberships (Epic RW-E012 — RW-060).
 *
 * This is the tenant boundary layer. An {@link Organization} groups users via
 * {@link Membership} rows (a user CAN belong to multiple orgs). Tenant roles
 * (OrgAdmin/Teacher/Member/Student) are SEPARATE from the global `Role`
 * (Admin/Reader): an OrgAdmin is not a ReadWise system admin, and a system
 * admin is treated as a super-user across every org (defense-in-depth).
 *
 * Design notes:
 *   - Additive & nullable: an account with no Membership behaves EXACTLY like
 *     the pre-tenancy single-user experience. Nothing here runs unless a user
 *     actually joins an org.
 *   - Tenant capabilities resolve through the SAME `@/lib/rbac` capability table
 *     as global roles (see {@link membershipCapabilities}).
 *   - DB helpers import the shared `prisma` singleton so they are unit-testable
 *     by mocking `@/lib/prisma`; the session guards compose `requireSession`.
 *
 * See `docs/multi-tenancy.md` for the full tenancy model.
 */
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { MembershipRole, Organization, Membership, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import {
  CAPABILITIES,
  membershipCapabilities,
  membershipHasCapability,
  type Capability,
} from "@/lib/rbac";

/** Result shape for guarded mutations (mirrors the admin-members convention). */
export type OrgMutationResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number };

/** A membership joined with its organization (for "my orgs" listings). */
export type MembershipWithOrg = Membership & { org: Organization };

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** URL-safe slug for an organization name (lowercase, hyphenated). */
export function slugifyOrg(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns a slug not currently used by any org. Tries `base`, then `base-2`,
 * `base-3`, … An empty base falls back to `org`.
 */
async function ensureUniqueOrgSlug(base: string): Promise<string> {
  const root = base || "org";
  let candidate = root;
  let n = 2;
  // Bounded loop — collisions are rare; cap attempts to avoid a hot loop.
  while (n < 1000) {
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${root}-${n}`;
    n++;
  }
  return `${root}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Capability resolution (per membership)
// ---------------------------------------------------------------------------

/** Capabilities granted by a membership role, or [] for no membership. */
export function orgCapabilities(
  membership: { role: MembershipRole } | null | undefined,
): readonly Capability[] {
  return membership ? membershipCapabilities(membership.role) : [];
}

/** True if the membership's role grants `capability`. Null membership ⇒ false. */
export function hasOrgCapability(
  membership: { role: MembershipRole } | null | undefined,
  capability: Capability,
): boolean {
  return membership ? membershipHasCapability(membership.role, capability) : false;
}

/** True for the global system roles that act as a super-user across every org. */
export function isSystemAdmin(role: string | null | undefined): boolean {
  return role === "Admin" || role === "System";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

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
    where: { userId_orgId: { userId, orgId } },
  });
}

/** All orgs a user belongs to, with the org joined, newest membership first. */
export function listUserOrganizations(
  userId: string,
): Promise<MembershipWithOrg[]> {
  return prisma.membership.findMany({
    where: { userId },
    include: { org: true },
    orderBy: { createdAt: "desc" },
  });
}

/** All members of an org with their user joined, OrgAdmins first then newest. */
export function listOrgMembers(orgId: string) {
  return prisma.membership.findMany({
    where: { orgId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

/** Count of OrgAdmins in an org — used to guard the last-admin rule. */
function countOrgAdmins(orgId: string): Promise<number> {
  return prisma.membership.count({ where: { orgId, role: "OrgAdmin" } });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

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

/**
 * Updates a member's role, refusing to demote the LAST OrgAdmin (a tenant must
 * always retain at least one administrator).
 */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: MembershipRole,
): Promise<OrgMutationResult<{ role: MembershipRole }>> {
  const membership = await getMembership(userId, orgId);
  if (!membership) return { ok: false, error: "Membership not found", status: 404 };
  if (membership.role === "OrgAdmin" && role !== "OrgAdmin") {
    const admins = await countOrgAdmins(orgId);
    if (admins <= 1) {
      return { ok: false, error: "Cannot demote the last organization admin", status: 409 };
    }
  }
  await prisma.membership.update({
    where: { userId_orgId: { userId, orgId } },
    data: { role },
  });
  return { ok: true, role };
}

/** Removes a member, refusing to remove the LAST OrgAdmin. */
export async function removeMember(
  orgId: string,
  userId: string,
): Promise<OrgMutationResult> {
  const membership = await getMembership(userId, orgId);
  if (!membership) return { ok: false, error: "Membership not found", status: 404 };
  if (membership.role === "OrgAdmin") {
    const admins = await countOrgAdmins(orgId);
    if (admins <= 1) {
      return { ok: false, error: "Cannot remove the last organization admin", status: 409 };
    }
  }
  await prisma.membership.delete({ where: { userId_orgId: { userId, orgId } } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Session guards (page-level)
// ---------------------------------------------------------------------------

export type OrgSession = { session: Session; membership: Membership | null };

/**
 * Requires an authenticated session that is a member of `orgId` (or a system
 * admin). Non-members are redirected to `/forbidden`. Returns the session plus
 * the membership (null only for a system-admin super-user).
 */
export async function requireOrgMembership(
  orgId: string,
  callbackUrl: string,
): Promise<OrgSession> {
  const session = await requireSession(callbackUrl);
  if (isSystemAdmin(session.user.role)) {
    const membership = await getMembership(session.user.id, orgId);
    return { session, membership };
  }
  const membership = await getMembership(session.user.id, orgId);
  if (!membership) redirect("/forbidden");
  return { session, membership };
}

/**
 * Requires the session to hold `capability` WITHIN `orgId` (via membership) or
 * be a system admin. Use for tenant features (e.g. `classroom.manage`).
 */
export async function requireOrgCapability(
  orgId: string,
  capability: Capability,
  callbackUrl: string,
): Promise<OrgSession> {
  const session = await requireSession(callbackUrl);
  if (isSystemAdmin(session.user.role)) {
    const membership = await getMembership(session.user.id, orgId);
    return { session, membership };
  }
  const membership = await getMembership(session.user.id, orgId);
  if (!hasOrgCapability(membership, capability)) redirect("/forbidden");
  return { session, membership };
}

/** Requires the session to administer `orgId` (OrgAdmin or system admin). */
export function requireOrgAdmin(orgId: string, callbackUrl: string): Promise<OrgSession> {
  return requireOrgCapability(orgId, CAPABILITIES.orgManage, callbackUrl);
}
