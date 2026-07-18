process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import type { AuditRequestInput } from "@/lib/security/audit";
import type { Role } from "@prisma/client";

type StubUser = { id: string; role: Role };

let stubUser: StubUser | null = null;
let adminCount = 2;
let ownedArticleCount = 0;
let userDeleteError: Error | null = null;
let auditError: Error | null = null;
let transactionCalled = false;
let deletedUserId: string | null = null;
let preparedUserIds: string[] = [];
let retirementOperations: string[] = [];
let auditCalls: Array<{ input: AuditRequestInput; tx: unknown }> = [];

before(() => {
  const prisma = {
    user: {
      findUnique: async () => stubUser,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCalled = true;
      let pendingDeletedUserId: string | null = null;
      const tx = {
        user: {
          count: async () => adminCount,
          delete: async ({ where }: { where: { id: string } }) => {
            if (userDeleteError) throw userDeleteError;
            pendingDeletedUserId = where.id;
            return { id: where.id };
          },
        },
        article: {
          count: async () => ownedArticleCount,
        },
      };
      const result = await callback(tx);
      deletedUserId = pendingDeletedUserId;
      return result;
    },
  };

  mock.module("@/lib/prisma", {
    namedExports: { prisma },
  });
  mock.module("@/lib/media", {
    namedExports: {
      prepareOwnedArticleMediaAssetRetirement: async (userId: string) => {
        preparedUserIds.push(userId);
        return {
          retire: async (operation: string) => {
            retirementOperations.push(operation);
          },
        };
      },
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: AuditRequestInput, tx: unknown) => {
        if (auditError) throw auditError;
        auditCalls.push({ input, tx });
      },
    },
  });
});

beforeEach(() => {
  stubUser = { id: "reader-1", role: "Reader" };
  adminCount = 2;
  ownedArticleCount = 0;
  userDeleteError = null;
  auditError = null;
  transactionCalled = false;
  deletedUserId = null;
  preparedUserIds = [];
  retirementOperations = [];
  auditCalls = [];
});

function auditForRemoval(result: { role: Role; ownedArticleCount: number }): AuditRequestInput {
  return {
    req: new Request("https://readwise.test/admin/members/reader-1"),
    action: "member.delete",
    targetType: "user",
    targetId: "reader-1",
    metadata: result,
  };
}

test("removeAccount returns not-found without opening a transaction", async () => {
  stubUser = null;
  const { removeAccount } = await import("@/lib/account-lifecycle/account-removal");

  const result = await removeAccount("missing", {
    mediaRetirementOperation: "account-delete",
  });

  assert.deepEqual(result, { ok: false, reason: "not-found" });
  assert.equal(transactionCalled, false);
  assert.deepEqual(preparedUserIds, []);
});

test("removeAccount commits deletion and audit before retiring media", async () => {
  ownedArticleCount = 3;
  const { removeAccount } = await import("@/lib/account-lifecycle/account-removal");

  const result = await removeAccount("reader-1", {
    audit: auditForRemoval,
    mediaRetirementOperation: "member-delete",
  });

  assert.deepEqual(result, {
    ok: true,
    role: "Reader",
    ownedArticleCount: 3,
  });
  assert.equal(deletedUserId, "reader-1");
  assert.deepEqual(preparedUserIds, ["reader-1"]);
  assert.deepEqual(retirementOperations, ["member-delete"]);
  assert.equal(auditCalls.length, 1);
  assert.deepEqual(auditCalls[0].input.metadata, {
    role: "Reader",
    ownedArticleCount: 3,
  });
});

test("removeAccount blocks deletion of the last admin inside the transaction", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  adminCount = 1;
  const { removeAccount } = await import("@/lib/account-lifecycle/account-removal");

  const result = await removeAccount("admin-1", {
    audit: auditForRemoval,
    mediaRetirementOperation: "member-delete",
  });

  assert.deepEqual(result, { ok: false, reason: "last-admin" });
  assert.equal(transactionCalled, true);
  assert.equal(deletedUserId, null);
  assert.equal(auditCalls.length, 0);
  assert.deepEqual(retirementOperations, []);
});

test("removeAccount rolls back and skips retirement when audit fails", async () => {
  auditError = new Error("audit unavailable");
  const { removeAccount } = await import("@/lib/account-lifecycle/account-removal");

  await assert.rejects(
    removeAccount("reader-1", {
      audit: auditForRemoval,
      mediaRetirementOperation: "account-delete",
    }),
    /audit unavailable/,
  );

  assert.equal(deletedUserId, null);
  assert.deepEqual(retirementOperations, []);
});

test("removeAccount propagates unexpected deletion errors without retiring media", async () => {
  userDeleteError = new Error("delete unavailable");
  const { removeAccount } = await import("@/lib/account-lifecycle/account-removal");

  await assert.rejects(
    removeAccount("reader-1", {
      mediaRetirementOperation: "account-delete",
    }),
    /delete unavailable/,
  );

  assert.equal(deletedUserId, null);
  assert.deepEqual(retirementOperations, []);
});
