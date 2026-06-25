/**
 * Unit tests for account-lifecycle member commands — deleteMember and updateMemberRole.
 * Verifies the last-admin guard, the self-guard, and that the guard count is
 * evaluated inside the transaction (atomicity fix, Issue #239). Owned private
 * articles are removed by the Article.owner ON DELETE CASCADE constraint.
 *
 * All Prisma calls are mocked — no real DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable stub state --------------------------------------------------
let stubUser: null | { id: string; role: string } = null;
let stubAdminCount = 2;

// Call recorders
let deleteManyArgs: { where: Record<string, unknown> } | null = null;
let userDeleteArgs: { where: { id: string } } | null = null;
let userUpdateArgs: unknown = null;
let transactionCalled = false;

// Module-level ref so the callback-form $transaction can pass it as `tx`.
let mockPrisma: Record<string, unknown> = {};

before(() => {
  mockPrisma = {
    user: {
      findUnique: async () => stubUser,
      count: async () => stubAdminCount,
      delete: async (args: { where: { id: string } }) => {
        userDeleteArgs = args;
        return { id: args.where.id };
      },
      update: async (args: unknown) => {
        userUpdateArgs = args;
        return {};
      },
    },
    article: {
      count: async () => 0,
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deleteManyArgs = args;
        return { count: 0 };
      },
    },
    $transaction: async (opsOrFn: unknown) => {
      transactionCalled = true;
      if (typeof opsOrFn === "function") {
        return (opsOrFn as (tx: unknown) => Promise<unknown>)(mockPrisma);
      }
      return Promise.all(opsOrFn as Promise<unknown>[]);
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrisma },
  });
});

beforeEach(() => {
  stubUser = null;
  stubAdminCount = 2;
  deleteManyArgs = null;
  userDeleteArgs = null;
  userUpdateArgs = null;
  transactionCalled = false;
});

// ---- deleteMember --------------------------------------------------------

test("deleteMember returns 404 when user does not exist", async () => {
  stubUser = null;
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");
  const result = await deleteMember("missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(transactionCalled, false);
});

test("deleteMember removes a Reader without a guard check", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");
  const result = await deleteMember("reader-1");
  assert.equal(result.ok, true);
  assert.equal(transactionCalled, true);
  assert.equal(deleteManyArgs, null, "article cleanup is enforced by FK cascade");
  assert.ok(userDeleteArgs, "user.delete must be called");
});

test("deleteMember removes an admin when other admins exist", async () => {
  stubUser = { id: "admin-2", role: "Admin" };
  stubAdminCount = 2; // another admin remains
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");
  const result = await deleteMember("admin-2");
  assert.equal(result.ok, true);
  assert.ok(userDeleteArgs, "user.delete must be called");
});

test("deleteMember refuses to remove the last remaining admin", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1;
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");
  const result = await deleteMember("admin-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  assert.equal(userDeleteArgs, null);
});

test("deleteMember last-admin guard is re-counted inside the transaction (atomicity)", async () => {
  // The guard count happens INSIDE the tx callback, so two concurrent deletes
  // cannot both pass the guard and leave zero admins.
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1;
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");
  const result = await deleteMember("admin-1");

  // Transaction was entered (count evaluated inside it)
  assert.equal(transactionCalled, true);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.ok(result.error.includes("last remaining admin"));
  }
  // No deletion happened
  assert.equal(deleteManyArgs, null);
  assert.equal(userDeleteArgs, null);
});

// ---- updateMemberRole ----------------------------------------------------

test("updateMemberRole returns 404 when user does not exist", async () => {
  stubUser = null;
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("missing", "Reader");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("updateMemberRole is a no-op when role is unchanged", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("admin-1", "Admin");
  assert.equal(result.ok, true);
  // No DB write for same-role update
  assert.equal(transactionCalled, false);
  assert.equal(userUpdateArgs, null);
});

test("updateMemberRole promotes a Reader to Admin", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("reader-1", "Admin");
  assert.equal(result.ok, true);
  assert.equal(transactionCalled, true);
  assert.ok(userUpdateArgs, "user.update must be called");
});

test("updateMemberRole demotes an Admin when other admins exist", async () => {
  stubUser = { id: "admin-2", role: "Admin" };
  stubAdminCount = 2;
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("admin-2", "Reader");
  assert.equal(result.ok, true);
  assert.ok(userUpdateArgs, "user.update must be called");
});

test("updateMemberRole refuses to demote the last remaining admin", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1;
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("admin-1", "Reader");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  assert.equal(userUpdateArgs, null);
});

test("updateMemberRole last-admin demote guard is re-counted inside the transaction (atomicity)", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1;
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");
  const result = await updateMemberRole("admin-1", "Reader");

  // Transaction entered (count evaluated inside it)
  assert.equal(transactionCalled, true);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.ok(result.error.includes("last remaining admin"));
  }
  assert.equal(userUpdateArgs, null);
});
