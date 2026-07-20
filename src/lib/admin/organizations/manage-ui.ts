/**
 * PURE, client-safe helpers for the admin organizations islands (#1163).
 *
 * Owns the presentation contract for the two client islands on the platform-admin
 * organizations surface WITHOUT any React/DOM/network:
 *   - the "Create organization" form (POST `/api/admin/organizations`), and
 *   - the per-member role/remove actions, which REUSE the existing tenant routes
 *     `/api/orgs/[id]/members/[memberId]` (PATCH/DELETE) rather than duplicating
 *     them (those routes already grant the system-admin super-user bypass).
 *
 * Keeping the endpoint builders + request DTOs here (client-safe, imports nothing
 * from the server) lets the islands be verified by source-string + mocked
 * `client-fetch` without jsdom.
 */
import type { MembershipRole } from "@prisma/client";

/** Roles an admin may assign to an existing org member from this surface. */
export const ADMIN_ORG_MEMBER_ROLES = [
  "OrgAdmin",
  "Teacher",
  "Member",
  "Student",
] as const satisfies readonly MembershipRole[];

/** The platform-admin organizations collection endpoint (GET list / POST create). */
export function adminOrganizationsEndpoint(): string {
  return "/api/admin/organizations";
}

/** The platform-admin single-organization detail endpoint. */
export function adminOrganizationEndpoint(orgId: string): string {
  return `/api/admin/organizations/${orgId}`;
}

/**
 * The EXISTING tenant member endpoint reused for role changes + removal. The
 * admin surface does not duplicate member mutations; it calls the tenant route,
 * which grants the system-admin super-user bypass.
 */
export function orgMemberEndpoint(orgId: string, memberId: string): string {
  return `/api/orgs/${orgId}/members/${memberId}`;
}

/** Request body for creating an organization from the admin surface. */
export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
  ownerUserId: string;
}

/**
 * Builds the exact POST body for creating an organization. Trims inputs and
 * omits `slug` when blank (the server derives it from the name). PURE.
 */
export function createOrganizationBody(input: {
  name: string;
  slug?: string;
  ownerUserId: string;
}): CreateOrganizationRequest {
  const slug = (input.slug ?? "").trim();
  return {
    name: input.name.trim(),
    ownerUserId: input.ownerUserId.trim(),
    ...(slug.length > 0 ? { slug } : {}),
  };
}
