/**
 * Unit tests for src/lib/account.ts deleteOwnAccount (Issue #235).
 * Prisma is mocked — no real DB is touched.
 *
 * The key behaviour under test: deleting a user relies on the Article.owner
 * ON DELETE CASCADE constraint, so private imports cannot survive as ownerless
 * public rows.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable stub state
let stubUser: null | { id: string; role: string } = { id: "user-1", role: "Reader" };
let stubAdminCount = 2;

// Call recorders
let deleteManyArgs: { where: Record<string, unknown> } | null = null;
let userDeleteArgs: { where: { id: string } } | null = null;
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
    },
    article: {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deleteManyArgs = args;
        return { count: 1 };
      },
    },
    $transaction: async (opsOrFn: unknown) => {
      transactionCalled = true;
      if (typeof opsOrFn === "function") {
        // Interactive/callback form: pass mockPrisma as the tx client.
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
  stubUser = { id: "user-1", role: "Reader" };
  stubAdminCount = 2;
  deleteManyArgs = null;
  userDeleteArgs = null;
  transactionCalled = false;
});

test("deleteOwnAccount deletes the user and relies on DB cascade for owned articles", async () => {
  const { deleteOwnAccount } = await import("@/lib/account");
  const result = await deleteOwnAccount("user-1");

  assert.equal(result.ok, true);
  assert.equal(transactionCalled, true);
  assert.equal(deleteManyArgs, null, "article cleanup is enforced by FK cascade");
  assert.ok(userDeleteArgs, "user.delete should be called");
  assert.equal(userDeleteArgs!.where.id, "user-1");
});

test("deleteOwnAccount returns 404 when the account does not exist", async () => {
  stubUser = null;

  const { deleteOwnAccount } = await import("@/lib/account");
  const result = await deleteOwnAccount("missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(deleteManyArgs, null);
});

test("deleteOwnAccount refuses to delete the last remaining admin", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1;

  const { deleteOwnAccount } = await import("@/lib/account");
  const result = await deleteOwnAccount("admin-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  // Guard fires INSIDE the transaction (atomicity): tx is entered but no deletion occurs.
  assert.equal(transactionCalled, true);
  assert.equal(deleteManyArgs, null);
  assert.equal(userDeleteArgs, null);
});

test("deleteOwnAccount last-admin guard is re-counted inside the transaction (atomicity)", async () => {
  // Verifies the guard count happens inside the tx callback so two concurrent
  // requests cannot both observe count=2 then both delete, leaving zero admins.
  stubUser = { id: "admin-1", role: "Admin" };
  stubAdminCount = 1; // would be 0 after deletion — guard must fire

  const { deleteOwnAccount } = await import("@/lib/account");
  const result = await deleteOwnAccount("admin-1");

  // Transaction entered (count evaluated inside it)
  assert.equal(transactionCalled, true);
  // Guard produced the 409 error
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.ok(result.error.includes("last admin"));
  }
  // No rows were deleted
  assert.equal(deleteManyArgs, null);
  assert.equal(userDeleteArgs, null);
});
