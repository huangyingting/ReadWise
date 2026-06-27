/**
 * Unit tests for the member support-command module (REF-052 / Issue #489).
 *
 * Covers revokeMemberSessions, exportMemberData, triggerMemberRepair, and
 * resendSignInHelp — each command's happy path, its 404 (missing member) guard,
 * audit invocation, and the command-specific branches (no-imports no-op,
 * missing-email rejection, export delegation failure).
 *
 * `@/lib/prisma`, `@/lib/security/audit`, `@/lib/account-lifecycle/account-commands`,
 * and `@/lib/processing/backfill` are mocked via node:test module mocking. No
 * real DB, queue, or network is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let userRow: { id: string; email?: string | null } | null = null;
let ownedArticles: { id: string }[] = [];
let exportResult: unknown = { user: { id: "u1" } };

let auditCalls: { action?: string }[] = [];
let backfillCalls: { filter?: { articleIds?: string[] }; operatorId?: string | null }[] = [];
let exportCalls: string[] = [];
let lastUserFindWhere: Record<string, unknown> | null = null;

const backfillResultStub = {
  dryRun: false,
  mode: "missing",
  features: ["difficulty", "tags"],
  reason: "support repair",
  scanned: 2,
  matched: 2,
  cap: 50,
  enqueued: 2,
  skippedExisting: 0,
  cleared: 0,
  jobIds: ["job-1", "job-2"],
  plan: [],
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique: async (args: { where: Record<string, unknown> }) => {
            lastUserFindWhere = args.where;
            return userRow;
          },
        },
        article: {
          findMany: async () => ownedArticles,
        },
        session: {
          deleteMany: async () => ({ count: 0 }),
        },
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: { action?: string }) => {
        auditCalls.push(input ?? {});
      },
    },
  });

  mock.module("@/lib/account-lifecycle/account-commands", {
    namedExports: {
      exportUserData: async (userId: string) => {
        exportCalls.push(userId);
        return exportResult;
      },
    },
  });

  mock.module("@/lib/processing/backfill", {
    namedExports: {
      BACKFILL_FEATURES: ["difficulty", "tags"],
      runBackfill: async (opts: {
        filter?: { articleIds?: string[] };
        operatorId?: string | null;
      }) => {
        backfillCalls.push(opts);
        return backfillResultStub;
      },
    },
  });
});

beforeEach(() => {
  userRow = null;
  ownedArticles = [];
  exportResult = { user: { id: "u1" } };
  auditCalls = [];
  backfillCalls = [];
  exportCalls = [];
  lastUserFindWhere = null;
});

// ---------------------------------------------------------------------------
// revokeMemberSessions (with the module-level prisma client default)
// ---------------------------------------------------------------------------

test("revokeMemberSessions deletes sessions via an injected client and audits", async () => {
  const { revokeMemberSessions } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  let deletedFor: string | null = null;
  const client = {
    user: { findUnique: async () => ({ id: "u1" }) },
    session: {
      deleteMany: async (args: { where: { userId: string } }) => {
        deletedFor = args.where.userId;
        return { count: 3 };
      },
    },
  };
  const result = await revokeMemberSessions(
    "u1",
    ({ revoked }) => ({ action: "admin.member.revoke_sessions", revoked } as never),
    client as never,
  );
  assert.deepEqual(result, { ok: true, revoked: 3 });
  assert.equal(deletedFor, "u1");
  assert.equal(auditCalls.at(-1)?.action, "admin.member.revoke_sessions");
});

test("revokeMemberSessions returns 404 when the member is unknown", async () => {
  const { revokeMemberSessions } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  const client = {
    user: { findUnique: async () => null },
    session: { deleteMany: async () => ({ count: 0 }) },
  };
  const result = await revokeMemberSessions("nope", undefined, client as never);
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
  assert.equal(auditCalls.length, 0);
});

test("revokeMemberSessions skips the audit when no factory is provided", async () => {
  const { revokeMemberSessions } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  const client = {
    user: { findUnique: async () => ({ id: "u1" }) },
    session: { deleteMany: async () => ({ count: 2 }) },
  };
  const result = await revokeMemberSessions("u1", undefined, client as never);
  assert.deepEqual(result, { ok: true, revoked: 2 });
  assert.equal(auditCalls.length, 0);
});

// ---------------------------------------------------------------------------
// exportMemberData
// ---------------------------------------------------------------------------

test("exportMemberData returns 404 when the member does not exist", async () => {
  const { exportMemberData } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = null;
  const result = await exportMemberData("nope");
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
  assert.equal(exportCalls.length, 0);
});

test("exportMemberData delegates to exportUserData and wraps the payload", async () => {
  const { exportMemberData } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1" };
  exportResult = { user: { id: "u1" }, savedWords: [] };

  const result = await exportMemberData("u1", { action: "admin.member.export" } as never);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, { user: { id: "u1" }, savedWords: [] });
  }
  assert.deepEqual(exportCalls, ["u1"]);
  assert.deepEqual(lastUserFindWhere, { id: "u1" });
});

test("exportMemberData returns 404 when the export collaborator yields nothing", async () => {
  const { exportMemberData } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1" };
  exportResult = null;

  const result = await exportMemberData("u1");
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
});

// ---------------------------------------------------------------------------
// triggerMemberRepair
// ---------------------------------------------------------------------------

test("triggerMemberRepair returns 404 when the member does not exist", async () => {
  const { triggerMemberRepair } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = null;
  const result = await triggerMemberRepair("nope", "admin-1");
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
  assert.equal(backfillCalls.length, 0);
});

test("triggerMemberRepair is a no-op when the member has no imported articles", async () => {
  const { triggerMemberRepair } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1" };
  ownedArticles = [];

  const result = await triggerMemberRepair("u1", "admin-1", (r) => ({
    action: "admin.member.repair",
    articleCount: r.articleCount,
  } as never));

  assert.deepEqual(result, { ok: true, result: null, articleCount: 0 });
  assert.equal(backfillCalls.length, 0, "backfill must not run with no articles");
  // The no-op path still audits the support intent.
  assert.equal(auditCalls.at(-1)?.action, "admin.member.repair");
});

test("triggerMemberRepair runs a missing-mode backfill over the member's articles", async () => {
  const { triggerMemberRepair } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1" };
  ownedArticles = [{ id: "art-1" }, { id: "art-2" }];

  const result = await triggerMemberRepair("u1", "admin-7", (r) => ({
    action: "admin.member.repair",
    articleCount: r.articleCount,
  } as never));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.articleCount, 2);
    assert.equal(result.result, backfillResultStub);
  }
  assert.equal(backfillCalls.length, 1);
  assert.deepEqual(backfillCalls[0].filter?.articleIds, ["art-1", "art-2"]);
  assert.equal(backfillCalls[0].operatorId, "admin-7");
  assert.equal(auditCalls.at(-1)?.action, "admin.member.repair");
});

test("triggerMemberRepair runs without an audit factory", async () => {
  const { triggerMemberRepair } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1" };
  ownedArticles = [{ id: "art-1" }];

  const result = await triggerMemberRepair("u1", null);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.articleCount, 1);
  assert.equal(auditCalls.length, 0);
});

// ---------------------------------------------------------------------------
// resendSignInHelp
// ---------------------------------------------------------------------------

test("resendSignInHelp returns 404 when the member does not exist", async () => {
  const { resendSignInHelp } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = null;
  const result = await resendSignInHelp("nope");
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
});

test("resendSignInHelp returns 400 when the member has no email on file", async () => {
  const { resendSignInHelp } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1", email: null };
  const result = await resendSignInHelp("u1");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /no email/i);
  }
  assert.equal(auditCalls.length, 0);
});

test("resendSignInHelp records intent and reports unavailability without leaking secrets", async () => {
  const { resendSignInHelp } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1", email: "ada@example.com" };

  const result = await resendSignInHelp("u1", ({ delivered }) => ({
    action: "admin.member.resend_signin",
    delivered,
  } as never));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.delivered, false);
    assert.equal(result.reason, "email_not_configured");
  }
  assert.equal(auditCalls.at(-1)?.action, "admin.member.resend_signin");
});

test("resendSignInHelp succeeds without an audit factory", async () => {
  const { resendSignInHelp } = await import(
    "@/lib/account-lifecycle/support-commands"
  );
  userRow = { id: "u1", email: "ada@example.com" };
  const result = await resendSignInHelp("u1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.reason, "email_not_configured");
  assert.equal(auditCalls.length, 0);
});
