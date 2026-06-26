/**
 * Retention and erasure helpers — focused tests (#712-A / #712-B / #712-C).
 *
 * Verifies timestamp-boundary behaviour and per-user erasure semantics for:
 *   - AI invocation ledger (src/lib/ai/retention.ts)
 *   - Audit log (src/lib/security/audit.ts)
 *   - Job queue terminal rows (src/lib/jobs/retention.ts)
 *
 * No real DB — prisma is fully mocked. Node's built-in test runner only.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- shared mock state ------------------------------------------------------

let aiDeleteManyArgs: unknown[] = [];
let aiDeleteManyCount = 0;

let auditDeleteManyArgs: unknown[] = [];
let auditDeleteManyCount = 0;
let auditFindManyRows: unknown[] = [];
let auditCountRows = 0;

let jobDeleteManyArgs: unknown[] = [];
let jobDeleteManyCount = 0;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiInvocation: {
          deleteMany: async (args: unknown) => {
            aiDeleteManyArgs.push(args);
            return { count: aiDeleteManyCount };
          },
        },
        auditLog: {
          create: async () => ({ id: "al-1" }),
          count: async () => auditCountRows,
          findMany: async () => auditFindManyRows,
          deleteMany: async (args: unknown) => {
            auditDeleteManyArgs.push(args);
            return { count: auditDeleteManyCount };
          },
        },
        job: {
          deleteMany: async (args: unknown) => {
            jobDeleteManyArgs.push(args);
            return { count: jobDeleteManyCount };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  aiDeleteManyArgs = [];
  aiDeleteManyCount = 0;
  auditDeleteManyArgs = [];
  auditDeleteManyCount = 0;
  auditFindManyRows = [];
  auditCountRows = 0;
  jobDeleteManyArgs = [];
  jobDeleteManyCount = 0;
});

// ============================================================================
// 712-A — AI invocation ledger retention
// ============================================================================

test("pruneOldAiInvocations: deletes records older than the cutoff date", async () => {
  const { pruneOldAiInvocations } = await import("@/lib/ai/retention");
  aiDeleteManyCount = 5;
  const now = new Date("2026-06-01T00:00:00Z");
  const removed = await pruneOldAiInvocations(30, undefined, now);
  assert.equal(removed, 5);
  assert.equal(aiDeleteManyArgs.length, 1);
  const where = (aiDeleteManyArgs[0] as { where: { createdAt: { lt: Date } } }).where;
  const cutoff = where.createdAt.lt;
  // 30 days before 2026-06-01 is 2026-05-02
  assert.equal(cutoff.toISOString().slice(0, 10), "2026-05-02");
});

test("pruneOldAiInvocations: returns 0 when nothing matches (mocked count=0)", async () => {
  const { pruneOldAiInvocations } = await import("@/lib/ai/retention");
  aiDeleteManyCount = 0;
  const removed = await pruneOldAiInvocations(90, undefined, new Date("2026-01-01T00:00:00Z"));
  assert.equal(removed, 0);
  assert.equal(aiDeleteManyArgs.length, 1);
});

test("pruneOldAiInvocations: falls back to default days when given invalid value", async () => {
  const { pruneOldAiInvocations } = await import("@/lib/ai/retention");
  aiDeleteManyCount = 0;
  const now = new Date("2026-06-01T00:00:00Z");
  // -1 is invalid; should fall back to the env default (365)
  await pruneOldAiInvocations(-1, undefined, now);
  const where = (aiDeleteManyArgs[0] as { where: { createdAt: { lt: Date } } }).where;
  const cutoff = where.createdAt.lt;
  // 365 days before 2026-06-01
  const expected = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test("deleteAiInvocationsForUser: issues deleteMany with the correct userId filter", async () => {
  const { deleteAiInvocationsForUser } = await import("@/lib/ai/retention");
  aiDeleteManyCount = 3;
  const removed = await deleteAiInvocationsForUser("user-abc");
  assert.equal(removed, 3);
  const where = (aiDeleteManyArgs[0] as { where: { userId: string } }).where;
  assert.equal(where.userId, "user-abc");
});

test("deleteAiInvocationsForUser: is a no-op for an empty userId", async () => {
  const { deleteAiInvocationsForUser } = await import("@/lib/ai/retention");
  const removed = await deleteAiInvocationsForUser("");
  assert.equal(removed, 0);
  assert.equal(aiDeleteManyArgs.length, 0, "deleteMany must not be called for empty userId");
});

test("deleteAiInvocationsForUser: uses injected client (not global prisma)", async () => {
  const { deleteAiInvocationsForUser } = await import("@/lib/ai/retention");
  let called = false;
  let capturedWhere: unknown;
  const fakeClient = {
    aiInvocation: {
      deleteMany: async (args: unknown) => {
        called = true;
        capturedWhere = (args as { where: unknown }).where;
        return { count: 7 };
      },
    },
  };
  const removed = await deleteAiInvocationsForUser(
    "user-xyz",
    fakeClient as unknown as Parameters<typeof deleteAiInvocationsForUser>[1],
  );
  assert.ok(called, "injected client's deleteMany was called");
  assert.equal(removed, 7);
  assert.deepEqual(capturedWhere, { userId: "user-xyz" });
});

// ============================================================================
// 712-B — Audit log retention
// ============================================================================

test("pruneOldAuditLogs: deletes entries older than the cutoff date", async () => {
  const { pruneOldAuditLogs } = await import("@/lib/security/audit");
  auditDeleteManyCount = 12;
  const now = new Date("2026-06-15T00:00:00Z");
  const removed = await pruneOldAuditLogs(730, undefined, now);
  assert.equal(removed, 12);
  assert.equal(auditDeleteManyArgs.length, 1);
  const where = (auditDeleteManyArgs[0] as { where: { createdAt: { lt: Date } } }).where;
  const cutoff = where.createdAt.lt;
  // 730 days before 2026-06-15
  const expected = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test("pruneOldAuditLogs: falls back to default days when given invalid value", async () => {
  const { pruneOldAuditLogs } = await import("@/lib/security/audit");
  auditDeleteManyCount = 0;
  const now = new Date("2026-06-01T00:00:00Z");
  // 0 is invalid; should fall back to env default (730)
  await pruneOldAuditLogs(0, undefined, now);
  const where = (auditDeleteManyArgs[0] as { where: { createdAt: { lt: Date } } }).where;
  const cutoff = where.createdAt.lt;
  const expected = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test("pruneOldAuditLogs: respects AUDIT_LOG_RETENTION_DAYS env override", async () => {
  process.env.AUDIT_LOG_RETENTION_DAYS = "365";
  try {
    const { pruneOldAuditLogs } = await import("@/lib/security/audit");
    auditDeleteManyCount = 0;
    const now = new Date("2026-06-01T00:00:00Z");
    await pruneOldAuditLogs(undefined, undefined, now);
    const where = (auditDeleteManyArgs[0] as { where: { createdAt: { lt: Date } } }).where;
    const cutoff = where.createdAt.lt;
    // Should use 365 from env
    const expected = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
  } finally {
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
  }
});

test("pruneOldAuditLogs: uses injected client (not global prisma)", async () => {
  const { pruneOldAuditLogs } = await import("@/lib/security/audit");
  let called = false;
  let capturedWhere: unknown;
  const fakeClient = {
    auditLog: {
      deleteMany: async (args: unknown) => {
        called = true;
        capturedWhere = (args as { where: unknown }).where;
        return { count: 4 };
      },
    },
  };
  const removed = await pruneOldAuditLogs(
    30,
    fakeClient as unknown as Parameters<typeof pruneOldAuditLogs>[1],
    new Date("2026-06-01T00:00:00Z"),
  );
  assert.ok(called, "injected client deleteMany was called");
  assert.equal(removed, 4);
  // Verify cutoff field name matches schema
  assert.ok(
    typeof (capturedWhere as Record<string, unknown>).createdAt === "object",
    "filter uses createdAt field",
  );
});

// ============================================================================
// 712-C — Job queue terminal row retention
// ============================================================================

test("pruneTerminalJobs: deletes COMPLETED and DEAD_LETTER rows older than cutoff", async () => {
  const { pruneTerminalJobs, JOB_TERMINAL_STATUSES } = await import("@/lib/jobs/retention");
  jobDeleteManyCount = 8;
  const now = new Date("2026-06-01T00:00:00Z");
  const removed = await pruneTerminalJobs(90, JOB_TERMINAL_STATUSES, undefined, now);
  assert.equal(removed, 8);
  assert.equal(jobDeleteManyArgs.length, 1);
  const where = (jobDeleteManyArgs[0] as { where: { status: { in: string[] }; updatedAt: { lt: Date } } }).where;
  // Both terminal statuses must appear in the filter
  assert.ok(where.status.in.includes("COMPLETED"), "filter includes COMPLETED");
  assert.ok(where.status.in.includes("DEAD_LETTER"), "filter includes DEAD_LETTER");
  const cutoff = where.updatedAt.lt;
  // 90 days before 2026-06-01
  const expected = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test("pruneTerminalJobs: with an empty statuses array returns 0 and makes no DB call", async () => {
  const { pruneTerminalJobs } = await import("@/lib/jobs/retention");
  const removed = await pruneTerminalJobs(90, [], undefined, new Date());
  assert.equal(removed, 0);
  assert.equal(jobDeleteManyArgs.length, 0, "no deleteMany when statuses is empty");
});

test("pruneTerminalJobs: falls back to default days for invalid olderThanDays", async () => {
  const { pruneTerminalJobs, JOB_TERMINAL_STATUSES } = await import("@/lib/jobs/retention");
  jobDeleteManyCount = 0;
  const now = new Date("2026-06-01T00:00:00Z");
  await pruneTerminalJobs(-5, JOB_TERMINAL_STATUSES, undefined, now);
  const where = (jobDeleteManyArgs[0] as { where: { updatedAt: { lt: Date } } }).where;
  const cutoff = where.updatedAt.lt;
  // Default is 90 days
  const expected = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  assert.equal(cutoff.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
});

test("pruneTerminalJobs: can be scoped to DEAD_LETTER only", async () => {
  const { pruneTerminalJobs } = await import("@/lib/jobs/retention");
  jobDeleteManyCount = 2;
  const { JobStatus } = await import("@prisma/client");
  const now = new Date("2026-06-01T00:00:00Z");
  const removed = await pruneTerminalJobs(30, [JobStatus.DEAD_LETTER], undefined, now);
  assert.equal(removed, 2);
  const where = (jobDeleteManyArgs[0] as { where: { status: { in: string[] } } }).where;
  assert.deepEqual(where.status.in, ["DEAD_LETTER"]);
});

test("pruneTerminalJobs: uses injected client (not global prisma)", async () => {
  const { pruneTerminalJobs, JOB_TERMINAL_STATUSES } = await import("@/lib/jobs/retention");
  let called = false;
  const fakeClient = {
    job: {
      deleteMany: async () => {
        called = true;
        return { count: 3 };
      },
    },
  };
  const removed = await pruneTerminalJobs(
    30,
    JOB_TERMINAL_STATUSES,
    fakeClient as unknown as Parameters<typeof pruneTerminalJobs>[2],
    new Date(),
  );
  assert.ok(called, "injected client deleteMany was called");
  assert.equal(removed, 3);
});

test("jobTerminalRetentionDays: respects JOB_TERMINAL_RETENTION_DAYS env override", async () => {
  process.env.JOB_TERMINAL_RETENTION_DAYS = "180";
  try {
    const { jobTerminalRetentionDays } = await import("@/lib/jobs/retention");
    assert.equal(jobTerminalRetentionDays(), 180);
  } finally {
    delete process.env.JOB_TERMINAL_RETENTION_DAYS;
  }
});
