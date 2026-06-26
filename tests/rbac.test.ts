/**
 * RBAC model + capability-guard tests (RW-011).
 *
 * Section A exercises the PURE capability model in `@/lib/rbac` (no mocks): role
 * → capability resolution, allow/deny, and that the full near-term + future role
 * set is defined. Section B imports the REAL `@/lib/api-auth` and `@/lib/session`
 * guards with only `next-auth`, `@/lib/auth`, profile-preferences repository,
 * and `next/navigation`
 * mocked, proving the capability-backed guards preserve the former
 * Admin-access behavior without raw role checks.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

import {
  CAPABILITIES,
  ALL_CAPABILITIES,
  ACTIVE_ROLES,
  TENANT_ROLES,
  ROLE_CAPABILITIES,
  SYSTEM_ROLE,
  capabilitiesForRole,
  roleHasCapability,
  hasCapability,
  isKnownRole,
} from "@/lib/rbac";
import { makeSession } from "./support/auth-mock";

const ADMIN_ONLY_CAPS = [
  CAPABILITIES.adminAccess,
  CAPABILITIES.articlesManage,
  CAPABILITIES.tagsManage,
  CAPABILITIES.membersManage,
  CAPABILITIES.jobsManage,
  CAPABILITIES.analyticsView,
  CAPABILITIES.securityView,
  CAPABILITIES.contentModerate,
  CAPABILITIES.sourcesManage,
  CAPABILITIES.supportAssist,
] as const;

const BASE_CAPS = [
  CAPABILITIES.articlesRead,
  CAPABILITIES.profileManage,
  CAPABILITIES.studyManage,
  CAPABILITIES.progressTrack,
] as const;

// ---------------------------------------------------------------------------
// Section A — pure capability model
// ---------------------------------------------------------------------------

test("ACTIVE_ROLES is exactly the DB-backed Admin/Reader set", () => {
  assert.deepEqual([...ACTIVE_ROLES], ["Admin", "Reader"]);
});

test("Admin resolves to every current admin capability plus base", () => {
  const caps = capabilitiesForRole("Admin");
  for (const cap of [...ADMIN_ONLY_CAPS, ...BASE_CAPS]) {
    assert.ok(caps.includes(cap), `Admin should have ${cap}`);
    assert.ok(hasCapability({ role: "Admin" }, cap), `hasCapability Admin ${cap}`);
    assert.ok(roleHasCapability("Admin", cap));
  }
});

test("Reader resolves to base capabilities and NO admin capabilities", () => {
  const caps = capabilitiesForRole("Reader");
  for (const cap of BASE_CAPS) {
    assert.ok(caps.includes(cap), `Reader should have ${cap}`);
  }
  for (const cap of ADMIN_ONLY_CAPS) {
    assert.ok(!caps.includes(cap), `Reader must NOT have ${cap}`);
    assert.ok(!hasCapability({ role: "Reader" }, cap), `Reader denied ${cap}`);
  }
});

test("hasCapability denies anonymous / unknown / malformed principals", () => {
  assert.ok(!hasCapability(null, CAPABILITIES.adminAccess));
  assert.ok(!hasCapability(undefined, CAPABILITIES.articlesRead));
  assert.ok(!hasCapability({ role: null }, CAPABILITIES.articlesRead));
  assert.ok(!hasCapability({ role: "Nonsense" }, CAPABILITIES.adminAccess));
  assert.deepEqual(capabilitiesForRole("Nonsense"), []);
});

test("isKnownRole recognizes modeled roles only", () => {
  assert.ok(isKnownRole("Admin"));
  assert.ok(isKnownRole("Reader"));
  assert.ok(isKnownRole("Moderator"));
  assert.ok(isKnownRole("OrgAdmin"));
  assert.ok(!isKnownRole("Nope"));
  assert.ok(!isKnownRole(null));
});

test("System pseudo-principal is granted every capability", () => {
  for (const cap of ALL_CAPABILITIES) {
    assert.ok(roleHasCapability(SYSTEM_ROLE, cap), `System should have ${cap}`);
  }
});

test("full near-term + future role set is defined in the model", () => {
  // Planned system roles are module-private; verify via ROLE_CAPABILITIES keys.
  const plannedSystemRoles = ["Moderator", "ContentEditor", "SupportAgent"] as const;
  assert.deepEqual([...TENANT_ROLES], [
    "OrgAdmin",
    "Teacher",
    "ClassroomInstructor",
  ]);
  // Every modeled role has an explicit capability grant.
  for (const role of [...ACTIVE_ROLES, SYSTEM_ROLE, ...plannedSystemRoles, ...TENANT_ROLES, "Member", "Student"]) {
    assert.ok(
      Array.isArray(ROLE_CAPABILITIES[role as keyof typeof ROLE_CAPABILITIES]),
      `${role} must have a capability mapping`,
    );
  }
});

test("planned system roles grant their intended capabilities", () => {
  assert.ok(roleHasCapability("Moderator", CAPABILITIES.contentModerate));
  assert.ok(roleHasCapability("Moderator", CAPABILITIES.adminAccess));
  assert.ok(!roleHasCapability("Moderator", CAPABILITIES.membersManage));

  assert.ok(roleHasCapability("ContentEditor", CAPABILITIES.articlesManage));
  assert.ok(roleHasCapability("ContentEditor", CAPABILITIES.tagsManage));
  assert.ok(!roleHasCapability("ContentEditor", CAPABILITIES.membersManage));

  assert.ok(roleHasCapability("SupportAgent", CAPABILITIES.supportAssist));
});

test("tenant roles are separate from system admin access", () => {
  for (const role of TENANT_ROLES) {
    assert.ok(
      !roleHasCapability(role, CAPABILITIES.adminAccess),
      `${role} must NOT grant system admin.access`,
    );
  }
  assert.ok(roleHasCapability("OrgAdmin", CAPABILITIES.orgManage));
  assert.ok(roleHasCapability("Teacher", CAPABILITIES.classroomManage));
  assert.ok(
    roleHasCapability("ClassroomInstructor", CAPABILITIES.classroomStudentsManage),
  );
  // A tenant role still carries the base reader capabilities.
  assert.ok(roleHasCapability("Teacher", CAPABILITIES.articlesRead));
});

// ---------------------------------------------------------------------------
// Section B — real capability guards (behavior preserving)
// ---------------------------------------------------------------------------

let sessionState: Session | null = null;

before(() => {
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => sessionState },
  });
  mock.module("@/lib/auth", { namedExports: { authOptions: {} } });
  mock.module("@/lib/profile", {
    namedExports: { isUserOnboarded: async () => true },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw new Error(`REDIRECT:${url}`);
      },
    },
  });
});

beforeEach(() => {
  sessionState = null;
});

test("requireCapabilityApi: 401 when unauthenticated", async () => {
  sessionState = null;
  const { requireCapabilityApi } = await import("@/lib/api-auth");
  const res = await requireCapabilityApi(CAPABILITIES.articlesManage);
  assert.equal(res.error?.status, 401);
  assert.equal(res.session, undefined);
});

test("requireCapabilityApi: 403 when reader lacks the capability", async () => {
  sessionState = makeSession("Reader", "r1");
  const { requireCapabilityApi } = await import("@/lib/api-auth");
  const res = await requireCapabilityApi(CAPABILITIES.articlesManage);
  assert.equal(res.error?.status, 403);
  assert.equal(res.session?.user.id, "r1");
});

test("requireCapabilityApi: allows an admin holding the capability", async () => {
  sessionState = makeSession("Admin", "a1");
  const { requireCapabilityApi } = await import("@/lib/api-auth");
  const res = await requireCapabilityApi(CAPABILITIES.articlesManage);
  assert.equal(res.error, undefined);
  assert.equal(res.session?.user.id, "a1");
});

test("requireCapabilityApi with admin.access gates admin APIs", async () => {
  const { requireCapabilityApi } = await import("@/lib/api-auth");

  sessionState = null;
  assert.equal((await requireCapabilityApi(CAPABILITIES.adminAccess)).error?.status, 401);

  sessionState = makeSession("Reader", "r1");
  assert.equal((await requireCapabilityApi(CAPABILITIES.adminAccess)).error?.status, 403);

  sessionState = makeSession("Admin", "a1");
  const ok = await requireCapabilityApi(CAPABILITIES.adminAccess);
  assert.equal(ok.error, undefined);
  assert.equal(ok.session?.user.id, "a1");
});

test("requireCapability (page): redirects a reader to /forbidden", async () => {
  sessionState = makeSession("Reader", "r1");
  const { requireCapability } = await import("@/lib/session");
  await assert.rejects(
    () => requireCapability(CAPABILITIES.articlesManage, "/admin/articles"),
    /REDIRECT:\/forbidden/,
  );
});

test("requireCapability (page): allows an admin and returns the session", async () => {
  sessionState = makeSession("Admin", "a1");
  const { requireCapability } = await import("@/lib/session");
  const session = await requireCapability(CAPABILITIES.articlesManage, "/admin/articles");
  assert.equal(session.user.id, "a1");
});

test("requireCapability with admin.access gates admin pages", async () => {
  const { requireCapability } = await import("@/lib/session");

  sessionState = null;
  await assert.rejects(
    () => requireCapability(CAPABILITIES.adminAccess, "/admin"),
    /REDIRECT:\/signin\?callbackUrl=/,
  );

  sessionState = makeSession("Reader", "r1");
  await assert.rejects(
    () => requireCapability(CAPABILITIES.adminAccess, "/admin"),
    /REDIRECT:\/forbidden/,
  );

  sessionState = makeSession("Admin", "a1");
  const session = await requireCapability(CAPABILITIES.adminAccess, "/admin");
  assert.equal(session.user.id, "a1");
});
