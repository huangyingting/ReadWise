/**
 * Capability-based RBAC model (RW-011).
 *
 * ReadWise stores only `Admin` and `Reader` in the Prisma {@link Role} enum
 * today. That is enough to ship, but the product roadmap (moderators, content
 * editors, support agents, and tenant-level classroom/organization roles) needs
 * a permission model that can grow WITHOUT another hard-coded role check in
 * every page and route.
 *
 * This module is the single source of truth for that model. It is intentionally
 * PURE — no Prisma, no `next-auth`, no I/O — so it is trivially testable and can
 * be imported from server components, route handlers, middleware, and the CLI.
 *
 * Design:
 *   - {@link CAPABILITIES} are the fine-grained, named permissions. Code gates
 *     on these (e.g. `articles.manage`) instead of `role === "Admin"`.
 *   - {@link ROLES} enumerates every role in the model: the two ACTIVE roles
 *     that exist in the DB enum today, the `System` pseudo-principal used for
 *     trusted server/CLI contexts, and PLANNED system + tenant roles that are
 *     documented here but not yet assignable.
 *   - {@link ROLE_CAPABILITIES} maps each role to the capabilities it grants.
 *   - {@link hasCapability} resolves a principal's role to capabilities.
 *
 * Behavior today is identical to the previous `role === "Admin"` checks because
 * `Admin` is granted every current admin capability and `Reader` is granted only
 * the base reader capabilities. See `docs/rbac.md` for the migration path.
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
  /** Create, edit, rebuild AI for, and delete articles in the back-office. */
  articlesManage: "articles.manage",
  /** Manage the global tag taxonomy. */
  tagsManage: "tags.manage",
  /** Manage members: change roles, remove accounts. */
  membersManage: "members.manage",
  /** Operate the background processing queue (retry/cancel/backfill jobs). */
  jobsManage: "jobs.manage",
  /** View product/usage analytics dashboards. */
  analyticsView: "analytics.view",
  /** View security and audit logs. */
  securityView: "security.view",
  /** Moderate user-visible content (future Moderator role; Admin has it now). */
  contentModerate: "content.moderate",
  /** Assist members via support tooling (future SupportAgent role). */
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

  // --- Future tenant-level capabilities (placeholders, not wired yet) --------
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
 * user. Keep this in exact sync with `enum Role` in both Prisma schemas.
 */
export const ACTIVE_ROLES = ["Admin", "Reader"] as const;
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
 * `"System"` role already used by `@/lib/article-access`.
 */
export const SYSTEM_ROLE = "System" as const;

/**
 * System-level roles planned for a later migration. Documented here so the model
 * is reviewable in code, but NOT yet present in the DB enum — no user can hold
 * one until the migration described in `docs/rbac.md` lands.
 */
export const PLANNED_SYSTEM_ROLES = [
  "Moderator",
  "ContentEditor",
  "SupportAgent",
] as const;
export type PlannedSystemRole = (typeof PLANNED_SYSTEM_ROLES)[number];

/**
 * Tenant-level (organization/classroom) roles. These are SEPARATE from global
 * system roles by design (an org admin is not a ReadWise system admin). They
 * are placeholders for the tenant model in ADR-0008 and are not wired yet.
 */
export const TENANT_ROLES = [
  "OrgAdmin",
  "Teacher",
  "ClassroomInstructor",
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Every role name known to the model. */
export type RoleName =
  | ActiveRole
  | typeof SYSTEM_ROLE
  | PlannedSystemRole
  | TenantRole;

/** Roles that are documented but not yet assignable. */
export const PLANNED_ROLES: readonly RoleName[] = [
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

/** Capabilities a full system administrator holds today. */
const ADMIN_CAPABILITIES: readonly Capability[] = [
  ...BASE_READER_CAPABILITIES,
  CAPABILITIES.adminAccess,
  CAPABILITIES.articlesManage,
  CAPABILITIES.tagsManage,
  CAPABILITIES.membersManage,
  CAPABILITIES.jobsManage,
  CAPABILITIES.analyticsView,
  CAPABILITIES.securityView,
  CAPABILITIES.contentModerate,
  CAPABILITIES.supportAssist,
];

/**
 * Role → capability mapping. The ACTIVE roles (`Admin`, `Reader`) and the
 * `System` principal are consulted at runtime today; the PLANNED entries
 * document the intended grants for the future migration and are exercised only
 * by tests until the roles become assignable.
 */
export const ROLE_CAPABILITIES: Record<RoleName, readonly Capability[]> = {
  // Active, DB-backed roles -------------------------------------------------
  Admin: ADMIN_CAPABILITIES,
  Reader: BASE_READER_CAPABILITIES,
  // Trusted server/CLI principal -------------------------------------------
  System: ALL_CAPABILITIES,
  // Planned system roles (not assignable yet) ------------------------------
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
  // Planned tenant roles (not assignable yet) ------------------------------
  OrgAdmin: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.orgManage,
    CAPABILITIES.orgMembersManage,
    CAPABILITIES.classroomManage,
    CAPABILITIES.classroomAssignmentsManage,
    CAPABILITIES.classroomStudentsManage,
  ],
  Teacher: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.classroomManage,
    CAPABILITIES.classroomAssignmentsManage,
    CAPABILITIES.classroomStudentsManage,
  ],
  ClassroomInstructor: [
    ...BASE_READER_CAPABILITIES,
    CAPABILITIES.classroomAssignmentsManage,
    CAPABILITIES.classroomStudentsManage,
  ],
};

/** A principal whose capabilities we want to resolve (e.g. a session user). */
export type CapabilityPrincipal = { role?: string | null } | null | undefined;

/** Returns true if `role` is one defined by the model. */
export function isKnownRole(role: string | null | undefined): role is RoleName {
  return role != null && role in ROLE_CAPABILITIES;
}

/**
 * Resolves the capability set granted to a role. Unknown roles resolve to no
 * capabilities (deny-by-default), so a malformed/legacy role string can never
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

/**
 * The single runtime authorization check. Resolves the principal's role to its
 * capability set and tests membership. A null/anonymous principal is denied.
 *
 * Today every session user has role `Admin` or `Reader`, so this returns the
 * exact same answer as the previous `role === "Admin"` checks — that is the
 * point: the refactor is behavior-preserving.
 */
export function hasCapability(
  principal: CapabilityPrincipal,
  capability: Capability,
): boolean {
  return roleHasCapability(principal?.role, capability);
}
