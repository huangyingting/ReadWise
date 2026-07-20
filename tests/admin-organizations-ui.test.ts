/**
 * Unit tests for the platform-admin organizations UI wiring (#1163).
 *
 * The tenant system already owns org/member/classroom CRUD, but staff had no
 * `/admin` surface to oversee tenants. This adds two client islands —
 * `AdminOrgCreate` (create + seed first OrgAdmin) and `AdminOrgMemberActions`
 * (role change / removal, REUSING the existing tenant routes) — backed by pure
 * helpers in `src/lib/admin/organizations/manage-ui.ts`.
 *
 * Mirrors the source-string + mocked-`client-fetch` convention of
 * tests/admin-series-article-manager-ui.test.ts (no jsdom / real DOM). The pure
 * endpoint/body builders are asserted directly (and via mocks); the islands are
 * verified by source-string. Backend behaviour stays covered by
 * tests/admin-organizations-routes.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  ADMIN_ORG_MEMBER_ROLES,
  adminOrganizationEndpoint,
  adminOrganizationsEndpoint,
  createOrganizationBody,
  orgMemberEndpoint,
} from "@/lib/admin/organizations/manage-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type PostCall = { url: string; body: unknown };
type PatchCall = { url: string; body: unknown };
type DeleteCall = { url: string };
let postCalls: PostCall[] = [];
let patchCalls: PatchCall[] = [];
let deleteCalls: DeleteCall[] = [];
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      postJson: async (url: string, body: unknown) => {
        postCalls.push({ url, body });
        return { ok: true };
      },
      patchJson: async (url: string, body: unknown) => {
        patchCalls.push({ url, body });
        return { ok: true };
      },
      deleteJson: async (url: string) => {
        deleteCalls.push({ url });
        return { ok: true };
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  postCalls = [];
  patchCalls = [];
  deleteCalls = [];
});

// ---------------------------------------------------------------------------
// Endpoint builders — exact strings
// ---------------------------------------------------------------------------

test("adminOrganizationsEndpoint is the admin collection route", () => {
  assert.equal(adminOrganizationsEndpoint(), "/api/admin/organizations");
});

test("adminOrganizationEndpoint targets a single org under /admin", () => {
  assert.equal(adminOrganizationEndpoint("org-9"), "/api/admin/organizations/org-9");
});

test("orgMemberEndpoint reuses the EXISTING tenant member route (not a duplicate under /admin)", () => {
  assert.equal(orgMemberEndpoint("org-9", "user-3"), "/api/orgs/org-9/members/user-3");
});

// ---------------------------------------------------------------------------
// createOrganizationBody — pure, trims, omits blank slug
// ---------------------------------------------------------------------------

test("createOrganizationBody trims inputs and includes a non-blank slug", () => {
  assert.deepEqual(
    createOrganizationBody({ name: "  Acme  ", slug: "  acme  ", ownerUserId: "  user-1 " }),
    { name: "Acme", ownerUserId: "user-1", slug: "acme" },
  );
});

test("createOrganizationBody omits the slug entirely when blank (server derives it)", () => {
  const body = createOrganizationBody({ name: "Acme", slug: "   ", ownerUserId: "user-1" });
  assert.deepEqual(body, { name: "Acme", ownerUserId: "user-1" });
  assert.deepEqual(Object.keys(body), ["name", "ownerUserId"]);
});

test("ADMIN_ORG_MEMBER_ROLES matches the assignable MembershipRole set", () => {
  assert.deepEqual([...ADMIN_ORG_MEMBER_ROLES], ["OrgAdmin", "Teacher", "Member", "Student"]);
});

// ---------------------------------------------------------------------------
// Mocked client-fetch — the exact calls the islands make
// ---------------------------------------------------------------------------

test("postJson creates via the admin collection endpoint with exactly { name, slug?, ownerUserId }", async () => {
  await clientFetch.postJson(
    adminOrganizationsEndpoint(),
    createOrganizationBody({ name: "Acme", ownerUserId: "user-1" }),
  );
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0]?.url, "/api/admin/organizations");
  assert.deepEqual(postCalls[0]?.body, { name: "Acme", ownerUserId: "user-1" });
});

test("patchJson changes a member role via the tenant member endpoint with { role }", async () => {
  await clientFetch.patchJson(orgMemberEndpoint("org-1", "user-3"), { role: "Teacher" });
  assert.equal(patchCalls[0]?.url, "/api/orgs/org-1/members/user-3");
  assert.deepEqual(patchCalls[0]?.body, { role: "Teacher" });
});

test("deleteJson removes a member via the tenant member endpoint", async () => {
  await clientFetch.deleteJson(orgMemberEndpoint("org-1", "user-3"));
  assert.equal(deleteCalls[0]?.url, "/api/orgs/org-1/members/user-3");
});

// ---------------------------------------------------------------------------
// AdminOrgCreate island — client component, primitives, wiring
// ---------------------------------------------------------------------------

test("AdminOrgCreate is a client island wired to the create endpoint + body builder", () => {
  const src = readSrc("src/components/admin/organizations/AdminOrgCreate.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("postJson"), "creates via postJson");
  assert.ok(src.includes("adminOrganizationsEndpoint"), "builds the URL from the pure helper");
  assert.ok(src.includes("createOrganizationBody"), "builds the body from the pure helper");
  assert.ok(src.includes("useAdminAction"), "uses the shared admin action hook for busy/error/refresh");
  assert.ok(src.includes("ownerUserId"), "captures the owner user id (first OrgAdmin)");
  assert.ok(src.includes("<Input"), "composes from the Input primitive");
  assert.ok(src.includes("<Button"), "composes from the Button primitive");
  assert.ok(src.includes("<Card"), "composes from the Card primitive");
});

test("AdminOrgMemberActions is a client island reusing the tenant member routes", () => {
  const src = readSrc("src/components/admin/organizations/AdminOrgMemberActions.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("patchJson"), "changes role via patchJson");
  assert.ok(src.includes("deleteJson"), "removes via deleteJson");
  assert.ok(src.includes("orgMemberEndpoint"), "builds the tenant member URL from the pure helper");
  assert.ok(
    !src.includes("/api/admin/organizations"),
    "does NOT duplicate member mutations under /admin — reuses the tenant route",
  );
  assert.ok(src.includes("ConfirmAction"), "confirms destructive removal");
  assert.ok(src.includes("<Select"), "composes from the Select primitive");
  assert.ok(src.includes("useAdminAction"), "uses the shared admin action hook");
});

// ---------------------------------------------------------------------------
// Token-driven (no raw hex / inline font-size / inline style)
// ---------------------------------------------------------------------------

for (const rel of [
  "src/components/admin/organizations/AdminOrgCreate.tsx",
  "src/components/admin/organizations/AdminOrgMemberActions.tsx",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}

// ---------------------------------------------------------------------------
// Pages are gated on organizations.manage
// ---------------------------------------------------------------------------

test("both admin org pages gate on the organizations.manage capability", () => {
  const list = readSrc("src/app/admin/organizations/page.tsx");
  const detail = readSrc("src/app/admin/organizations/[id]/page.tsx");
  for (const src of [list, detail]) {
    assert.ok(src.includes("requireCapability"), "gates via requireCapability");
    assert.ok(
      src.includes("CAPABILITIES.organizationsManage"),
      "gates on the new organizations.manage capability",
    );
  }
});

test("the admin nav exposes an Organizations section", () => {
  const src = readSrc("src/components/AdminNav.tsx");
  assert.ok(src.includes('href: "/admin/organizations"'), "adds the /admin/organizations link");
  assert.ok(src.includes('label: "Organizations"'), "labels it Organizations");
});
