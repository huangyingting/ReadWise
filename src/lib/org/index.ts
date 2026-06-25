/**
 * Organizations & memberships — public API (Epic RW-E012 — RW-060).
 *
 * This barrel re-exports the focused sub-modules so existing imports of
 * `@/lib/org` continue to work without modification:
 *
 *   - {@link ./slugs}    — slug helpers (`slugifyOrg`)
 *   - {@link ./guards}   — capability helpers + session guards
 *   - {@link ./queries}  — read-only DB access
 *   - {@link ./commands} — mutation commands with last-admin business rules
 *
 * This is the tenant boundary layer. An Organization groups users via Membership
 * rows (a user CAN belong to multiple orgs). Tenant roles (OrgAdmin/Teacher/
 * Member/Student) are SEPARATE from the global Role (Admin/Reader): an OrgAdmin
 * is not a ReadWise system admin, and a system admin is treated as a super-user
 * across every org (defense-in-depth).
 *
 * See `docs/multi-tenancy.md` for the full tenancy model.
 */
export { slugifyOrg } from "./slugs";
export {
  type OrgSession,
  orgCapabilities,
  hasOrgCapability,
  isSystemAdmin,
  requireOrgMembership,
  requireOrgCapability,
  requireOrgAdmin,
} from "./guards";
export {
  type MembershipWithOrg,
  getOrganization,
  getOrganizationBySlug,
  getMembership,
  listUserOrganizations,
  listOrgMembers,
} from "./queries";
export {
  type OrgMutationResult,
  type CreateOrganizationInput,
  createOrganization,
  addMember,
  updateMemberRole,
  removeMember,
} from "./commands";
