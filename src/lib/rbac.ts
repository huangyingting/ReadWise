/**
 * Capability-based RBAC model (RW-011).
 *
 * ReadWise stores assignable global roles in the Prisma {@link Role} enum.
 * Capability-based checks let admins delegate scoped access to moderators,
 * content editors, support agents, and future tenant-level classroom/organization
 * roles WITHOUT another hard-coded role check in every page and route.
 *
 * This module is the single source of truth for that model. It is intentionally
 * PURE — no Prisma, no `next-auth`, no I/O — so it is trivially testable and can
 * be imported from server components, route handlers, middleware, and the CLI.
 *
 * Design:
 *   - {@link CAPABILITIES} are the fine-grained, named permissions. Code gates
 *     on these (e.g. `articles.manage`) instead of `role === "Admin"`.
 *   - {@link ROLES} enumerates every role in the model: ACTIVE global roles
 *     that exist in the DB enum today, the `System` pseudo-principal used for
 *     trusted server/CLI contexts, and tenant roles that are documented here.
 *   - {@link ROLE_CAPABILITIES} maps each role to the capabilities it grants.
 *   - {@link hasCapability} resolves a principal's role to capabilities.
 *
 * `Admin` is granted every current admin capability, `Reader` is granted only
 * the base reader capabilities, and scoped admin roles receive targeted grants.
 * See `docs/access/rbac.md` for the role model.
 */

/**
 * Every named capability in the system. The string value is namespaced
 * (`<domain>.<verb>`) so logs and audit trails read clearly. Code should import
 * the {@link CAPABILITIES} constant rather than hand-writing these strings.
 */
export const CAPABILITIES = {
  // --- System / back-office capabilities (currently granted to Admin) -------
  /** Enter the `/admin` back-office at all (umbrella for the admin area). */
  adminAccess: "admin.access",
  /** Act as an unrestricted platform super-user across articles and tenants. */
  platformSuperuser: "platform.superuser",
  /** Create, edit, rebuild AI for, and delete articles in the back-office. */
  articlesManage: "articles.manage",
  /** Manage the global tag taxonomy. */
  tagsManage: "tags.manage",
  /** Manage members: change roles, remove accounts. */
  membersManage: "members.manage",
  /**
   * Platform-wide organization oversight from `/admin`: list every tenant,
   * create organizations, and manage their memberships/classrooms as a
   * super-user. This is the GLOBAL back-office counterpart to the tenant-scoped
   * `org.manage` capability (which is resolved per-membership); it is granted to
   * the global `Admin` role only, never to a tenant OrgAdmin.
   */
  organizationsManage: "organizations.manage",
  /** Operate the background processing queue (retry/cancel/backfill jobs). */
  jobsManage: "jobs.manage",
  /** View product/usage analytics dashboards. */
  analyticsView: "analytics.view",
  /** View security and audit logs. */
  securityView: "security.view",
  /** Moderate user-visible content (Moderator and Admin). */
  contentModerate: "content.moderate",
  /** Manage content sources / provider governance (enable/disable, health). */
  sourcesManage: "sources.manage",
  /** Assist members via support tooling (SupportAgent and Admin). */
  supportAssist: "support.assist",

  // --- Base reader capabilities (granted to every authenticated user) -------
  /** Read articles the principal is allowed to see. */
  articlesRead: "articles.read",
  /** Manage one's own profile/settings. */
  profileManage: "profile.manage",
  /** Manage one's own study list / saved words / bookmarks. */
  studyManage: "study.manage",
  /** Track one's own reading progress. */
  progressTrack: "progress.track",

  // --- Tenant-level capabilities (wired via membership roles) ---------------
  // These are resolved from a user's Membership/ClassroomMembership role by the
  // org/classroom guards (`@/lib/org/guards`, `@/lib/classroom/guards`) and their
  // route-handler twins in `@/lib/tenant-api`, and gate the real `/api/orgs/*`,
  // `/api/classrooms/*`, and `/api/assignments/*` routes. They are SEPARATE from
  // the global back-office capabilities above (an OrgAdmin is not a staff admin).
  /** Administer an organization/tenant. */
  orgManage: "org.manage",
  /** Manage members within an organization/tenant. */
  orgMembersManage: "org.members.manage",
  /** Create and manage classrooms. */
  classroomManage: "classroom.manage",
  /** Create and grade classroom assignments. */
  classroomAssignmentsManage: "classroom.assignments.manage",
  /** Manage classroom rosters/students. */
  classroomStudentsManage: "classroom.students.manage",
} as const;

/** Union of all capability string literals. */
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/** Every capability value, useful for documentation/tests. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.values(CAPABILITIES);

/**
 * Roles that exist in the Prisma `Role` enum TODAY and can be assigned to a
 * user. Keep this in exact sync with `enum Role` in all Prisma schemas.
 */
export const ACTIVE_ROLES = [
  "Admin",
  "Reader",
  "Moderator",
  "ContentEditor",
  "SupportAgent",
] as const;
export type ActiveRole = (typeof ACTIVE_ROLES)[number];

// Compile-time guard: `ActiveRole` must stay identical to the Prisma `Role`
// enum. If a role is added to/removed from the schema without updating
// ACTIVE_ROLES (or vice versa), `RolesMatch` resolves to `false` and the
// `Expect<...>` alias fails to satisfy its `true` constraint.
type PrismaRoleName = `${import("@prisma/client").Role}`;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type _AssertActiveRolesMatchPrisma = Expect<Equals<ActiveRole, PrismaRoleName>>;

/**
 * Trusted non-user principal used by server/CLI contexts (e.g. the article
 * processing pipeline). It is NOT stored in the DB and is never assigned to a
 * sign-in; it simply grants full capability to system automation. Mirrors the
 * `"System"` role used by `@/lib/article-library` access policy helpers.
 */
export const SYSTEM_ROLE = "System" as const;

// No planned global system roles remain; scoped admin roles are active DB roles.
const PLANNED_SYSTEM_ROLES = [] as const;

/**
 * Tenant-level (organization/classroom) roles. These are SEPARATE from global
 * system roles by design (an org admin is not a ReadWise system admin). They are
 * wired via membership capability resolution: an org/classroom membership role
 * is resolved through the SAME capability table as global roles (see
 * {@link membershipCapabilities}), so the org/classroom guards can gate tenant
 * features. `OrgAdmin`/`Teacher` are assignable on a {@link Membership} via
 * `updateMemberRole`; `ClassroomInstructor` is documentation-only (not a Prisma
 * `MembershipRole`/`ClassroomRole` value — see {@link MEMBERSHIP_ROLES}/
 * {@link CLASSROOM_ROLES} for the assignable sets).
 */
export const TENANT_ROLES = [
  "OrgAdmin",
  "Teacher",
  "ClassroomInstructor",
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Roles assignable on a {@link Membership} row (RW-060). These map 1:1 onto the
 * Prisma `MembershipRole` enum. `OrgAdmin`/`Teacher` reuse the tenant capability
 * grants above; `Member`/`Student` carry only the base reader capabilities (a
 * plain org member is not privileged beyond the global single-user experience).
 */
export const MEMBERSHIP_ROLES = [
  "OrgAdmin",
  "Teacher",
  "Member",
  "Student",
] as const;
export type MembershipRoleName = (typeof MEMBERSHIP_ROLES)[number];

/**
 * Roles assignable on a {@link ClassroomMembership} row (RW-061). Maps 1:1 onto
 * the Prisma `ClassroomRole` enum. A classroom `Teacher` can manage the roster
 * and assignments for THAT classroom; a `Student` only receives assignments.
 */
export const CLASSROOM_ROLES = ["Teacher", "Student"] as const;
export type ClassroomRoleName = (typeof CLASSROOM_ROLES)[number];

/** Every role name known to the model. */
export type RoleName =
  | ActiveRole
  | typeof SYSTEM_ROLE
  | TenantRole
  | "Member"
  | "Student";

/** Roles that are documented but not yet assignable (kept module-private). */
const PLANNED_ROLES: readonly RoleName[] = [
  ...PLANNED_SYSTEM_ROLES,
  ...TENANT_ROLES,
];

/** Capabilities every authenticated reader holds. */
const BASE_READER_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.articlesRead,
  CAPABILITIES.profileManage,
  CAPABILITIES.studyManage,
  CAPABILITIES.progressTrack,
];

/** Back-office privileges granted to a full system administrator today. */
const ADMIN_BACK_OFFICE_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.adminAccess,
  CAPABILITIES.platformSuperuser,
  CAPABILITIES.articlesManage,
  CAPABILITIES.tagsManage,
  CAPABILITIES.membersManage,
  CAPABILITIES.organizationsManage,
  CAPABILITIES.jobsManage,
  CAPABILITIES.analyticsView,
  CAPABILITIES.securityView,
  CAPABILITIES.contentModerate,
  CAPABILITIES.sourcesManage,
  CAPABILITIES.supportAssist,
];

/** Capabilities granted to tenant organization administrators. */
const ORG_ADMIN_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.orgManage,
  CAPABILITIES.orgMembersManage,
  CAPABILITIES.classroomManage,
  CAPABILITIES.classroomAssignmentsManage,
  CAPABILITIES.classroomStudentsManage,
];

/** Capabilities granted to tenant classroom teachers. */
const TEACHER_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.classroomManage,
  CAPABILITIES.classroomAssignmentsManage,
  CAPABILITIES.classroomStudentsManage,
];

/** Capabilities a full system administrator holds today. */
const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...BASE_READER_CAPABILITIES,
  ...ADMIN_BACK_OFFICE_CAPABILITIES,
];

/**
 * Role → capability mapping. ACTIVE global roles and the `System` principal are
 * consulted at runtime today; tenant entries support membership capability
 * resolution on the separate organization/classroom axis.
 */
export const ROLE_CAPABILITIES: Record<RoleName, readonly Capability[]> = {
  // Active, DB-backed global roles -----------------------------------------
  Admin: ADMIN_CAPABILITIES,
  Reader: BASE_READER_CAPABILITIES,
  Moderator: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.adminAccess,
    CAPABILITIES.contentModerate,
    CAPABILITIES.articlesManage,
  ],
  ContentEditor: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.adminAccess,
    CAPABILITIES.articlesManage,
    CAPABILITIES.tagsManage,
  ],
  SupportAgent: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.adminAccess,
    CAPABILITIES.supportAssist,
    CAPABILITIES.analyticsView,
  ],
  // Trusted server/CLI principal -------------------------------------------
  System: ALL_CAPABILITIES,
  // Tenant roles — resolved via membership capability lookups. OrgAdmin and
  // Teacher are assignable on a Membership row via `updateMemberRole`
  // (MembershipRole); ClassroomInstructor is documentation-only (not a Prisma
  // MembershipRole/ClassroomRole value) and is kept here for the capability map.
  OrgAdmin: [
    ...BASE_READER_CAPABILITIES,
    ...ORG_ADMIN_CAPABILITIES,
  ],
  Teacher: [
    ...BASE_READER_CAPABILITIES,
    ...TEACHER_CAPABILITIES,
  ],
  ClassroomInstructor: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.classroomAssignmentsManage,
    CAPABILITIES.classroomStudentsManage,
  ],
  // Plain tenant membership roles — base reader capabilities only. A Member or
  // Student is not privileged beyond the global single-user experience; their
  // tenant scoping is enforced by org/classroom membership lookups, not caps.
  Member: BASE_READER_CAPABILITIES,
  Student: BASE_READER_CAPABILITIES,
};

/** A principal whose capabilities we want to resolve (e.g. a session user). */
export type CapabilityPrincipal = { role?: string | null } | null | undefined;

/** Returns true if `role` is one defined by the model. */
export function isKnownRole(role: string | null | undefined): role is RoleName {
  return role != null && role in ROLE_CAPABILITIES;
}

/**
 * Resolves the capability set granted to a role. Unknown roles resolve to no
 * capabilities (deny-by-default), so a malformed or stale role string can never
 * accidentally escalate.
 */
export function capabilitiesForRole(
  role: string | null | undefined,
): readonly Capability[] {
  return isKnownRole(role) ? ROLE_CAPABILITIES[role] : [];
}

/** Returns true if a specific role grants a specific capability. */
export function roleHasCapability(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  return capabilitiesForRole(role).includes(capability);
}

/** True only for principals that have unrestricted platform super-user access. */
export function isPlatformSuperuser(
  principal: CapabilityPrincipal,
): boolean {
  return roleHasCapability(principal?.role, CAPABILITIES.platformSuperuser);
}

/** Role-only variant for guards that have not built a full principal object. */
export function roleIsPlatformSuperuser(
  role: string | null | undefined,
): boolean {
  return roleHasCapability(role, CAPABILITIES.platformSuperuser);
}

/**
 * The single runtime authorization check. Resolves the principal's role to its
 * capability set and tests membership. A null/anonymous principal is denied.
 *
 * Session users resolve through the same capability table whether they are full
 * admins, readers, or scoped admin roles.
 */
export function hasCapability(
  principal: CapabilityPrincipal,
  capability: Capability,
): boolean {
  return roleHasCapability(principal?.role, capability);
}

/**
 * Resolves the capabilities granted by a tenant {@link Membership} /
 * {@link ClassroomMembership} role (RW-060/061). This is the integration point
 * for tenant authorization: an org/classroom role is resolved through the SAME
 * capability table as global roles, so a Teacher membership yields
 * `classroom.manage` etc. Unknown roles resolve to no capabilities
 * (deny-by-default). A null membership (no tenant relationship) yields none.
 */
export function membershipCapabilities(
  role: MembershipRoleName | ClassroomRoleName | string | null | undefined,
): readonly Capability[] {
  return capabilitiesForRole(role);
}

/** Returns true if a tenant membership role grants a specific capability. */
export function membershipHasCapability(
  role: MembershipRoleName | ClassroomRoleName | string | null | undefined,
  capability: Capability,
): boolean {
  return roleHasCapability(role, capability);
}
