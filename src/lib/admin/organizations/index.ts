/**
 * Platform-admin organization oversight — read model (#1163).
 *
 * The tenant system (`@/lib/org`, `@/lib/classroom`) already owns organization,
 * membership, and classroom CRUD, but its self-serve surface only ever lists the
 * orgs a caller BELONGS to. Platform staff (the global `Admin` role, gated on the
 * `organizations.manage` capability) had no way to see or manage tenants across
 * the whole platform. This module is the missing read side of that back-office
 * surface — a platform-wide org listing plus a single-org detail view.
 *
 * It is read-only and imports only the Prisma singleton; mutations reuse the
 * existing tenant commands (`createOrganization`, `addMember`, `updateMemberRole`,
 * `removeMember`) via the API routes. Mirrors the focused-module shape used by
 * `src/lib/admin/*` (member-list etc.).
 *
 * Privacy: an authorized admin may SEE member emails/names in the UI, but this
 * module never logs or persists them — it only shapes rows for rendering.
 */
export {
  ADMIN_ORGANIZATIONS_PAGE_SIZE,
  ADMIN_ORG_SORT_KEYS,
  type AdminOrgSortKey,
  type AdminOrganizationRow,
  type AdminOrganizationSearch,
  type ListOrganizationsOpts,
  listOrganizations,
} from "./queries";
export {
  type AdminOrganizationDetail,
  type AdminOrgMemberRow,
  type AdminOrgClassroomRow,
  getOrganizationDetail,
} from "./detail";
