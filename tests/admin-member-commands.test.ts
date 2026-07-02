process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AuditRequestInput } from "@/lib/security/audit";

type StubRole = "Admin" | "Reader";
type StubUser = { id: string; role: StubRole };

let stubUser: StubUser | null = null;
let stubAdminCount = 2;
let ownedArticleCount = 0;
let ownedStorageKeys: string[] = [];
let userUpdateError: Error | null = null;
let userDeleteError: Error | null = null;
let transactionCalled = false;
let userUpdateArgs: unknown = null;
let userDeleteArgs: unknown = null;
let auditCalls: Array<{ input: AuditRequestInput; tx: unknown }> = [];
let storageDeleteCalls: string[] = [];
let mediaStorage: { delete: (storageKey: string) => Promise<void> } | null = null;
let mockPrisma: Record<string, unknown> = {};

function makeAudit(action: string, metadata: Record<string, unknown> = {}): AuditRequestInput {
  return {
    action,
    targetType: "user",
    targetId: "member-1",
    metadata,
    req: new Request("https://readwise.test/admin/members/member-1"),
  };
}

before(() => {
  mockPrisma = {
    user: {
      findUnique: async () => stubUser,
      count: async () => stubAdminCount,
      update: async (args: unknown) => {
        if (userUpdateError) throw userUpdateError;
        userUpdateArgs = args;
        return {};
      },
      delete: async (args: unknown) => {
        if (userDeleteError) throw userDeleteError;
        userDeleteArgs = args;
        return {};
      },
    },
    article: {
      count: async () => ownedArticleCount,
    },
    mediaAsset: {
      findMany: async () => ownedStorageKeys.map((storageKey) => ({ storageKey })),
    },
    $transaction: async (fn: unknown) => {
      transactionCalled = true;
      return (fn as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    },
  };

  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrisma },
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: { securityAdminAccessDenied: "security.admin_access_denied" },
      auditRequestInfo: () => ({}),
      recordAuditFromRequest: async (input: AuditRequestInput, tx?: unknown) => {
        auditCalls.push({ input, tx });
      },
      tryRecordAuditLog: async () => {},
    },
  });
  mock.module("@/lib/storage/runtime", {
    namedExports: {
      getMediaStorage: () => mediaStorage,
    },
  });
});

beforeEach(() => {
  stubUser = null;
  stubAdminCount = 2;
  ownedArticleCount = 0;
  ownedStorageKeys = [];
  userUpdateError = null;
  userDeleteError = null;
  transactionCalled = false;
  userUpdateArgs = null;
  userDeleteArgs = null;
  auditCalls = [];
  storageDeleteCalls = [];
  mediaStorage = null;
});

test("updateMemberRole audits an unchanged role without opening a transaction", async () => {
  stubUser = { id: "admin-1", role: "Admin" };
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");

  const result = await updateMemberRole("admin-1", "Admin", (auditResult) =>
    makeAudit("member.role.noop", { changed: auditResult.changed, role: auditResult.role }),
  );

  assert.equal(result.ok, true);
  assert.equal(transactionCalled, false);
  assert.equal(userUpdateArgs, null);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].tx, undefined);
  assert.deepEqual(auditCalls[0].input.metadata, { changed: false, role: "Admin" });
});

test("updateMemberRole audits a changed role inside the transaction", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");

  const result = await updateMemberRole("reader-1", "Admin", (auditResult) =>
    makeAudit("member.role.changed", {
      changed: auditResult.changed,
      previousRole: auditResult.previousRole,
      role: auditResult.role,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(transactionCalled, true);
  assert.ok(userUpdateArgs);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].tx, mockPrisma);
  assert.deepEqual(auditCalls[0].input.metadata, {
    changed: true,
    previousRole: "Reader",
    role: "Admin",
  });
});

test("updateMemberRole rethrows unexpected transaction errors", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  userUpdateError = new Error("update exploded");
  const { updateMemberRole } = await import("@/lib/account-lifecycle/member-commands");

  await assert.rejects(() => updateMemberRole("reader-1", "Admin"), /update exploded/);
  assert.equal(transactionCalled, true);
  assert.equal(auditCalls.length, 0);
});

test("deleteMember audits deletion and best-effort purges owned storage keys", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  ownedArticleCount = 3;
  ownedStorageKeys = ["asset-a", "asset-b"];
  mediaStorage = {
    delete: async (storageKey: string) => {
      storageDeleteCalls.push(storageKey);
      if (storageKey === "asset-b") throw new Error("delete failed");
    },
  };
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");

  const result = await deleteMember("reader-1", (auditResult) =>
    makeAudit("member.delete", {
      ownedArticleCount: auditResult.ownedArticleCount,
      role: auditResult.role,
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.ownedArticleCount, 3);
    assert.equal(result.role, "Reader");
  }
  assert.ok(userDeleteArgs);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].tx, mockPrisma);
  assert.deepEqual(auditCalls[0].input.metadata, {
    ownedArticleCount: 3,
    role: "Reader",
  });
  assert.deepEqual(storageDeleteCalls, ["asset-a", "asset-b"]);
});

test("deleteMember rethrows unexpected transaction errors", async () => {
  stubUser = { id: "reader-1", role: "Reader" };
  userDeleteError = new Error("delete exploded");
  const { deleteMember } = await import("@/lib/account-lifecycle/member-commands");

  await assert.rejects(() => deleteMember("reader-1"), /delete exploded/);
  assert.equal(transactionCalled, true);
  assert.equal(storageDeleteCalls.length, 0);
});
