/**
 * Organization capability helpers and session guards.
 *
 * Resolves tenant capabilities from membership roles and provides page-level
 * session guards that redirect non-members to `/forbidden`. System-admin
 * super-users (global Admin/System roles) bypass membership checks for all
 * tenant operations.
 *
 * Note: OrgAdmin is a TENANT role — it must never confer global system-admin
 * privileges. {@link isSystemAdmin} is the only place that maps global roles to
 * the super-user path.
 */
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { Membership, MembershipRole } from "@prisma/client";
import { requireSession } from "@/lib/session";
import {
  CAPABILITIES,
  membershipCapabilities,
  membershipHasCapability,
  roleHasCapability,
  type Capability,
} from "@/lib/rbac";
import { getMembership } from "./queries";

export type OrgSession = { session: Session; membership: Membership | null };

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
  return roleHasCapability(role, CAPABILITIES.adminAccess);
}

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
