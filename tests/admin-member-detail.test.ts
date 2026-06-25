/**
 * Member support-detail tests (RW-053). `@/lib/prisma` and the audit/account/
 * backfill collaborators are mocked; `getMemberDetail` + `revokeMemberSessions`
 * are exercised with an INJECTED fake client (no real DB). Verifies the detail
 * assembles profile/progress/imports/audit, returns null for a missing user,
 * and that session revocation deletes rows + audits.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let auditCalls: { action: string }[] = [];

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/audit", {
    namedExports: {
      AUDIT_ACTIONS: {},
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push(input);
      },
    },
  });
  mock.module("@/lib/account", {
    namedExports: { exportUserData: async (id: string) => ({ user: { id } }) },
  });
  mock.module("@/lib/backfill", {
    namedExports: {
      BACKFILL_FEATURES: ["difficulty", "tags"],
      runBackfill: async () => ({ enqueued: 1, skippedExisting: 0 }),
    },
  });
});

beforeEach(() => {
  auditCalls = [];
});

function detailClient(user: unknown) {
  return {
    user: { findUnique: async () => user },
    readingProgress: {
      aggregate: async () => ({ _avg: { percent: 42 } }),
      count: async (args: { where: { completed?: boolean } }) =>
        args.where.completed ? 2 : 5,
    },
    dailyActivity: {
      findMany: async () => [
        { date: new Date("2026-06-20T00:00:00Z"), articlesRead: 3 },
      ],
    },
    article: {
      findMany: async () => [
        {
          id: "a1",
          title: "Imported One",
          status: "draft",
          sourceType: "IMPORTED",
          createdAt: new Date("2026-06-18T00:00:00Z"),
        },
      ],
      count: async () => 1,
    },
    session: {
      count: async () => 2,
      aggregate: async () => ({ _max: { expires: new Date("2026-07-01T00:00:00Z") } }),
    },
    auditLog: {
      findMany: async () => [
        {
          id: "al1",
          action: "admin.member.role_update",
          actorId: "admin-1",
          actorRole: "Admin",
          createdAt: new Date("2026-06-19T00:00:00Z"),
          metadata: JSON.stringify({ role: "Reader" }),
        },
      ],
    },
  };
}

test("getMemberDetail assembles profile, progress, imports and audit", async () => {
  const { getMemberDetail } = await import("@/lib/admin-member-detail");
  const user = {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
    image: null,
    role: "Reader",
    emailVerified: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    profile: {
      englishLevel: "B1",
      topics: ["science", "tech"],
      ageRange: null,
      gender: null,
      dailyGoal: 2,
      completedAt: new Date("2026-01-02T00:00:00Z"),
    },
    _count: { savedWords: 7, quizAttempts: 3 },
  };
  const detail = await getMemberDetail("u1", detailClient(user) as never);
  assert.ok(detail);
  assert.equal(detail!.user.email, "ada@example.com");
  assert.equal(detail!.progress.started, 5);
  assert.equal(detail!.progress.completed, 2);
  assert.equal(detail!.progress.inProgress, 3);
  assert.equal(detail!.progress.avgPercent, 42);
  assert.equal(detail!.savedWords, 7);
  assert.equal(detail!.quizAttempts, 3);
  assert.deepEqual(detail!.profile?.topics, ["science", "tech"]);
  assert.equal(detail!.importCount, 1);
  assert.equal(detail!.imports[0].title, "Imported One");
  assert.equal(detail!.sessions.active, 2);
  assert.equal(detail!.auditTrail[0].action, "admin.member.role_update");
  assert.deepEqual(detail!.auditTrail[0].metadata, { role: "Reader" });
});

test("getMemberDetail returns null for a missing user", async () => {
  const { getMemberDetail } = await import("@/lib/admin-member-detail");
  const detail = await getMemberDetail("nope", detailClient(null) as never);
  assert.equal(detail, null);
});

test("revokeMemberSessions deletes sessions and audits", async () => {
  const { revokeMemberSessions } = await import("@/lib/admin-member-detail");
  let deletedFor: string | null = null;
  const client = {
    user: { findUnique: async () => ({ id: "u1" }) },
    session: {
      deleteMany: async (args: { where: { userId: string } }) => {
        deletedFor = args.where.userId;
        return { count: 4 };
      },
    },
  };
  const result = await revokeMemberSessions(
    "u1",
    ({ revoked }) => ({ action: "admin.member.revoke_sessions", revoked } as never),
    client as never,
  );
  assert.deepEqual(result, { ok: true, revoked: 4 });
  assert.equal(deletedFor, "u1");
  assert.equal(auditCalls.at(-1)?.action, "admin.member.revoke_sessions");
});

test("revokeMemberSessions returns 404 for a missing user", async () => {
  const { revokeMemberSessions } = await import("@/lib/admin-member-detail");
  const client = {
    user: { findUnique: async () => null },
    session: { deleteMany: async () => ({ count: 0 }) },
  };
  const result = await revokeMemberSessions("nope", undefined, client as never);
  assert.deepEqual(result, { ok: false, error: "Not found", status: 404 });
});
