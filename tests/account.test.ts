/**
 * Unit tests for src/lib/account.ts deleteOwnAccount (Issue #235).
 * Prisma is mocked — no real DB is touched.
 *
 * The key behaviour under test: deleting a user must ALSO delete that user's
 * owned (personally-imported) articles in the same transaction, so an
 * ownerId→NULL SetNull can't leave a status:"published" row world-readable.
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

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
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
        $transaction: async (ops: Promise<unknown>[]) => {
          transactionCalled = true;
          return Promise.all(ops);
        },
      },
    },
  });
});

beforeEach(() => {
  stubUser = { id: "user-1", role: "Reader" };
  stubAdminCount = 2;
  deleteManyArgs = null;
  userDeleteArgs = null;
  transactionCalled = false;
});

test("deleteOwnAccount deletes the user's owned articles in the same transaction", async () => {
  const { deleteOwnAccount } = await import("@/lib/account");
  const result = await deleteOwnAccount("user-1");

  assert.equal(result.ok, true);
  assert.equal(transactionCalled, true);
  assert.ok(deleteManyArgs, "article.deleteMany should be called");
  assert.deepEqual(deleteManyArgs!.where, { ownerId: "user-1" });
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
  // Guard fires before any deletion.
  assert.equal(deleteManyArgs, null);
  assert.equal(transactionCalled, false);
});
