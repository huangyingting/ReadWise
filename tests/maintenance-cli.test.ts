process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const counts = {
  analytics: 0,
  ai: 0,
  audit: 0,
  jobs: 0,
};
const deletes = {
  analytics: 0,
  ai: 0,
  audit: 0,
  jobs: 0,
};
let auditCreates: Array<{ data: Record<string, unknown> }> = [];
let transactionCalls = 0;
let countArgs: Record<string, unknown[]> = {};
let deleteArgs: Record<string, unknown[]> = {};

type PrismaMock = {
  analyticsEvent: {
    count: (args: unknown) => Promise<number>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  aiInvocation: {
    count: (args: unknown) => Promise<number>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  auditLog: {
    count: (args: unknown) => Promise<number>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  job: {
    count: (args: unknown) => Promise<number>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  $transaction: <T>(fn: (tx: PrismaMock) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

const prismaMock: PrismaMock = {
  analyticsEvent: {
    count: async (args: unknown) => {
      countArgs.analytics = [args];
      return counts.analytics;
    },
    deleteMany: async (args: unknown) => {
      deleteArgs.analytics = [args];
      return { count: deletes.analytics };
    },
  },
  aiInvocation: {
    count: async (args: unknown) => {
      countArgs.ai = [args];
      return counts.ai;
    },
    deleteMany: async (args: unknown) => {
      deleteArgs.ai = [args];
      return { count: deletes.ai };
    },
  },
  auditLog: {
    count: async (args: unknown) => {
      countArgs.audit = [args];
      return counts.audit;
    },
    deleteMany: async (args: unknown) => {
      deleteArgs.audit = [args];
      return { count: deletes.audit };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      auditCreates.push(args);
      return { id: "audit-1" };
    },
  },
  job: {
    count: async (args: unknown) => {
      countArgs.jobs = [args];
      return counts.jobs;
    },
    deleteMany: async (args: unknown) => {
      deleteArgs.jobs = [args];
      return { count: deletes.jobs };
    },
  },
  $transaction: async <T>(fn: (tx: typeof prismaMock) => Promise<T>) => {
    transactionCalls++;
    return fn(prismaMock);
  },
  $disconnect: async () => undefined,
};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: { prisma: prismaMock },
  });
});

beforeEach(() => {
  counts.analytics = 2;
  counts.ai = 3;
  counts.audit = 4;
  counts.jobs = 5;
  deletes.analytics = 20;
  deletes.ai = 30;
  deletes.audit = 40;
  deletes.jobs = 50;
  auditCreates = [];
  transactionCalls = 0;
  countArgs = {};
  deleteArgs = {};
});

function captureIo() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    io: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

test("retention maintenance defaults to dry-run count output", async () => {
  const { retentionMaintenanceMain } = await import("../scripts/retention-maintenance");
  const { io, logs, errors } = captureIo();

  const code = await retentionMaintenanceMain(["--analytics-days", "10"], io);
  const payload = JSON.parse(logs[0]!) as { dryRun: boolean; results: Array<{ area: string; matched: number; deleted: number }> };

  assert.equal(code, 0);
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload.results.map((r) => [r.area, r.matched, r.deleted]), [
    ["analytics", 2, 0],
    ["ai", 3, 0],
    ["audit", 4, 0],
    ["jobs", 5, 0],
  ]);
  assert.deepEqual(deleteArgs, {});
  assert.match(errors[0]!, /Dry run only/);
});

test("retention maintenance prints help", async () => {
  const { retentionMaintenanceMain } = await import("../scripts/retention-maintenance");
  const { io, logs, errors } = captureIo();

  const code = await retentionMaintenanceMain(["--help"], io);

  assert.equal(code, 0);
  assert.match(logs[0]!, /maintenance:retention/);
  assert.deepEqual(errors, []);
});

test("retention maintenance executes all retention helpers when explicit", async () => {
  const { retentionMaintenanceMain } = await import("../scripts/retention-maintenance");
  const { io, logs, errors } = captureIo();

  const code = await retentionMaintenanceMain(["--execute"], io);
  const payload = JSON.parse(logs[0]!) as { executed: boolean; results: Array<{ area: string; deleted: number }> };

  assert.equal(code, 0);
  assert.equal(payload.executed, true);
  assert.deepEqual(payload.results.map((r) => [r.area, r.deleted]), [
    ["analytics", 20],
    ["ai", 30],
    ["audit", 40],
    ["jobs", 50],
  ]);
  assert.equal(Object.keys(deleteArgs).length, 4);
  assert.deepEqual(errors, []);
});

test("ledger erasure requires a user id", async () => {
  const { eraseUserLedgersMain } = await import("../scripts/erase-user-ledgers");
  const { io, errors } = captureIo();

  const code = await eraseUserLedgersMain([], io);

  assert.equal(code, 2);
  assert.match(errors[0]!, /--user-id/);
});

test("ledger erasure prints help", async () => {
  const { eraseUserLedgersMain } = await import("../scripts/erase-user-ledgers");
  const { io, logs, errors } = captureIo();

  const code = await eraseUserLedgersMain(["--help"], io);

  assert.equal(code, 0);
  assert.match(logs[0]!, /privacy:erase-ledgers/);
  assert.deepEqual(errors, []);
});

test("ledger erasure dry-run counts analytics and AI rows without deleting", async () => {
  const { eraseUserLedgersMain } = await import("../scripts/erase-user-ledgers");
  const { io, logs, errors } = captureIo();

  const code = await eraseUserLedgersMain(["--user-id", "user-1"], io);
  const payload = JSON.parse(logs[0]!) as { dryRun: boolean; analyticsEventsMatched: number; aiInvocationsMatched: number };

  assert.equal(code, 0);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.analyticsEventsMatched, 2);
  assert.equal(payload.aiInvocationsMatched, 3);
  assert.deepEqual(deleteArgs, {});
  assert.deepEqual(auditCreates, []);
  assert.match(errors[0]!, /Dry run only/);
});

test("ledger erasure execute deletes rows and audits metadata only", async () => {
  const { eraseUserLedgersMain } = await import("../scripts/erase-user-ledgers");
  const { io, logs, errors } = captureIo();

  const code = await eraseUserLedgersMain([
    "--user-id",
    "user-1",
    "--operator-id",
    "operator-1",
    "--execute",
  ], io);
  const payload = JSON.parse(logs[0]!) as { executed: boolean; analyticsEventsDeleted: number; aiInvocationsDeleted: number };
  const audit = auditCreates[0]!.data;
  const metadata = JSON.parse(audit.metadata as string) as Record<string, unknown>;

  assert.equal(code, 0);
  assert.equal(payload.executed, true);
  assert.equal(payload.analyticsEventsDeleted, 20);
  assert.equal(payload.aiInvocationsDeleted, 30);
  assert.equal(transactionCalls, 1);
  assert.equal(audit.action, "admin.ledger_erasure");
  assert.equal(audit.actorId, "operator-1");
  assert.equal(audit.targetId, "user-1");
  assert.deepEqual(metadata, {
    analyticsEventsMatched: 2,
    aiInvocationsMatched: 3,
    analyticsEventsDeleted: 20,
    aiInvocationsDeleted: 30,
  });
  assert.deepEqual(errors, []);
});
