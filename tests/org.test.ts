/**
 * Organization & membership helper tests (RW-060).
 *
 * `@/lib/prisma` is replaced with a tiny configurable fake; `@/lib/session` and
 * `next/navigation` are stubbed so the module's session guards don't pull the
 * real auth chain. Covers slug derivation, transactional org creation, and the
 * last-admin guards that keep a tenant from losing its only administrator.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Org = typeof import("@/lib/org");
let org: Org;

// --- mutable fake state, reset per test -----------------------------------
let slugTaken: Set<string>;
let membershipRow: { role: string } | null;
let adminCount: number;
let lastUpdate: unknown;
let lastDelete: unknown;
let lastCreatedOrg: Record<string, unknown> | null;
let lastCreatedMembership: Record<string, unknown> | null;

before(async () => {
  const prismaFake = {
    organization: {
      findUnique: async ({ where }: { where: { slug?: string } }) =>
        where.slug && slugTaken.has(where.slug) ? { id: "x" } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        lastCreatedOrg = { id: "org1", ...data };
        return lastCreatedOrg;
      },
    },
    membership: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        lastCreatedMembership = { id: "mem1", ...data };
        return lastCreatedMembership;
      },
      findUnique: async () => membershipRow,
      count: async () => adminCount,
      update: async (args: unknown) => {
        lastUpdate = args;
        return { id: "mem1" };
      },
      delete: async (args: unknown) => {
        lastDelete = args;
        return { id: "mem1" };
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prismaFake),
  };

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });
  mock.module("@/lib/session", {
    namedExports: { requireSession: async () => ({ user: { id: "u1", role: "Reader" } }) },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw new Error(`REDIRECT:${url}`);
      },
    },
  });

  org = await import("@/lib/org");
});

beforeEach(() => {
  slugTaken = new Set();
  membershipRow = null;
  adminCount = 1;
  lastUpdate = null;
  lastDelete = null;
  lastCreatedOrg = null;
  lastCreatedMembership = null;
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("slugifyOrg produces a url-safe slug", () => {
  assert.equal(org.slugifyOrg("Lincoln High ESL"), "lincoln-high-esl");
  assert.equal(org.slugifyOrg("Acme & Co."), "acme-and-co");
  assert.equal(org.slugifyOrg("  Trailing--Dashes  "), "trailing-dashes");
});

test("isSystemAdmin recognizes the global super-user roles only", () => {
  assert.ok(org.isSystemAdmin("Admin"));
  assert.ok(org.isSystemAdmin("System"));
  assert.ok(!org.isSystemAdmin("Reader"));
  assert.ok(!org.isSystemAdmin("OrgAdmin"));
  assert.ok(!org.isSystemAdmin(null));
});

test("hasOrgCapability resolves membership-role capabilities", () => {
  assert.ok(org.hasOrgCapability({ role: "OrgAdmin" }, "org.manage"));
  assert.ok(org.hasOrgCapability({ role: "Teacher" }, "classroom.manage"));
  assert.ok(!org.hasOrgCapability({ role: "Member" }, "classroom.manage"));
  assert.ok(!org.hasOrgCapability(null, "org.manage"));
});

// ---------------------------------------------------------------------------
// createOrganization
// ---------------------------------------------------------------------------

test("createOrganization seats the creator as the first OrgAdmin", async () => {
  const { organization, membership } = await org.createOrganization(
    { name: "Lincoln High ESL" },
    "creator-1",
  );
  assert.equal(organization.slug, "lincoln-high-esl");
  assert.equal(organization.name, "Lincoln High ESL");
  assert.equal(membership.role, "OrgAdmin");
  assert.equal((lastCreatedMembership as { userId: string }).userId, "creator-1");
});

test("createOrganization de-duplicates a taken slug", async () => {
  slugTaken = new Set(["acme"]);
  const { organization } = await org.createOrganization({ name: "Acme" }, "creator-1");
  assert.equal(organization.slug, "acme-2");
});

// ---------------------------------------------------------------------------
// Last-admin guards
// ---------------------------------------------------------------------------

test("updateMemberRole refuses to demote the last OrgAdmin", async () => {
  membershipRow = { role: "OrgAdmin" };
  adminCount = 1;
  const res = await org.updateMemberRole("o1", "u1", "Member");
  assert.equal(res.ok, false);
  assert.equal((res as { status: number }).status, 409);
  assert.equal(lastUpdate, null);
});

test("updateMemberRole allows demotion when another admin remains", async () => {
  membershipRow = { role: "OrgAdmin" };
  adminCount = 2;
  const res = await org.updateMemberRole("o1", "u1", "Member");
  assert.equal(res.ok, true);
  assert.notEqual(lastUpdate, null);
});

test("updateMemberRole 404s an unknown membership", async () => {
  membershipRow = null;
  const res = await org.updateMemberRole("o1", "ghost", "Member");
  assert.equal(res.ok, false);
  assert.equal((res as { status: number }).status, 404);
});

test("removeMember refuses to remove the last OrgAdmin", async () => {
  membershipRow = { role: "OrgAdmin" };
  adminCount = 1;
  const res = await org.removeMember("o1", "u1");
  assert.equal(res.ok, false);
  assert.equal((res as { status: number }).status, 409);
  assert.equal(lastDelete, null);
});

test("removeMember allows removing a non-last admin", async () => {
  membershipRow = { role: "OrgAdmin" };
  adminCount = 3;
  const res = await org.removeMember("o1", "u1");
  assert.equal(res.ok, true);
  assert.notEqual(lastDelete, null);
});

test("removeMember removes a plain member without guard", async () => {
  membershipRow = { role: "Member" };
  const res = await org.removeMember("o1", "u2");
  assert.equal(res.ok, true);
  assert.notEqual(lastDelete, null);
});
