import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

// Silence structured request logs emitted by the jobs module.
process.env.LOG_LEVEL = "error";
// Force the SQLite/generic claim path (no FOR UPDATE SKIP LOCKED) in tests.
delete process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// In-memory Prisma fake (no DB). Backs the `job` delegate + $transaction.
// ---------------------------------------------------------------------------

type JobRow = Record<string, unknown> & { id: string };

let store: Map<string, JobRow>;
let idCounter = 0;

function nowDate(): Date {
  return new Date();
}

function defaults(): JobRow {
  return {
    id: "",
    type: "ARTICLE_PROCESS",
    status: "PENDING",
    payload: {},
    attempts: 0,
    maxAttempts: 5,
    priority: 0,
    runAfter: nowDate(),
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    errorHistory: [],
    dedupeKey: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    deadLetteredAt: null,
    createdAt: nowDate(),
    updatedAt: nowDate(),
  };
}

function clone<T>(value: T): T {
  return value == null ? value : (structuredClone(value) as T);
}

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a == null || b == null) return NaN;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchField(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    if ("lte" in c) {
      const r = cmp(value, c.lte);
      return Number.isNaN(r) ? false : r <= 0;
    }
    if ("lt" in c) {
      const r = cmp(value, c.lt);
      return Number.isNaN(r) ? false : r < 0;
    }
    if ("gte" in c) {
      const r = cmp(value, c.gte);
      return Number.isNaN(r) ? false : r >= 0;
    }
    if ("gt" in c) {
      const r = cmp(value, c.gt);
      return Number.isNaN(r) ? false : r > 0;
    }
    if ("not" in c) return value !== c.not;
    return value === cond;
  }
  return value === cond;
}

function matchWhere(row: JobRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Record<string, unknown>[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (!matchField(row[key], cond)) return false;
  }
  return true;
}

function applyOrder(rows: JobRow[], orderBy?: Record<string, "asc" | "desc">[]): JobRow[] {
  if (!orderBy || orderBy.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0];
      const r = cmp(a[field], b[field]);
      if (!Number.isNaN(r) && r !== 0) return dir === "desc" ? -r : r;
    }
    return 0;
  });
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

const jobDelegate = {
  create: async ({ data }: { data: Record<string, unknown> }) => {
    if (data.dedupeKey != null) {
      for (const existing of store.values()) {
        if (existing.dedupeKey === data.dedupeKey) throw uniqueViolation();
      }
    }
    const id = (data.id as string) ?? `job-${++idCounter}`;
    const row: JobRow = { ...defaults(), ...data, id, createdAt: nowDate(), updatedAt: nowDate() };
    store.set(id, row);
    return clone(row);
  },
  findUnique: async ({ where }: { where: Record<string, unknown> }) => {
    if (where.id != null) return clone(store.get(where.id as string) ?? null);
    if (where.dedupeKey != null) {
      for (const row of store.values()) {
        if (row.dedupeKey === where.dedupeKey) return clone(row);
      }
    }
    return null;
  },
  findFirst: async ({
    where,
    orderBy,
  }: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">[];
  }) => {
    const rows = applyOrder(
      [...store.values()].filter((r) => matchWhere(r, where)),
      orderBy,
    );
    return clone(rows[0] ?? null);
  },
  findMany: async ({
    where,
    orderBy,
    take,
    skip,
  }: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">[];
    take?: number;
    skip?: number;
  }) => {
    let rows = applyOrder([...store.values()].filter((r) => matchWhere(r, where)), orderBy);
    if (skip) rows = rows.slice(skip);
    if (take != null) rows = rows.slice(0, take);
    return rows.map((r) => clone(r));
  },
  update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = store.get(where.id);
    if (!row) throw new Error(`job ${where.id} not found`);
    Object.assign(row, data);
    row.updatedAt = (data.updatedAt as Date) ?? nowDate();
    return clone(row);
  },
  updateMany: async ({
    where,
    data,
  }: {
    where?: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    const rows = [...store.values()].filter((r) => matchWhere(r, where));
    for (const row of rows) {
      Object.assign(row, data);
      row.updatedAt = (data.updatedAt as Date) ?? nowDate();
    }
    return { count: rows.length };
  },
  groupBy: async ({ by }: { by: string[] }) => {
    const counts = new Map<string, number>();
    for (const row of store.values()) {
      const key = by.map((b) => row[b]).join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => {
      const obj: Record<string, unknown> = { _count: { _all: count } };
      by.forEach((b, i) => (obj[b] = key.split("|")[i]));
      return obj;
    });
  },
};

const prismaFake = {
  job: jobDelegate,
  $transaction: async (fn: (tx: { job: typeof jobDelegate }) => unknown) => fn({ job: jobDelegate }),
};

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });
});

beforeEach(() => {
  store = new Map();
  idCounter = 0;
});

/** Seeds a job row directly (bypassing enqueue) with sane defaults. */
function seed(overrides: Partial<JobRow> = {}): JobRow {
  const id = (overrides.id as string) ?? `seed-${++idCounter}`;
  const row: JobRow = { ...defaults(), ...overrides, id };
  store.set(id, row);
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("enqueueJob creates a PENDING job with policy defaults", async () => {
  const { enqueueJob, JobType, JobStatus } = await import("@/lib/jobs");
  const job = await enqueueJob(JobType.ARTICLE_PROCESS, { articleId: "a1" });
  assert.equal(job.status, JobStatus.PENDING);
  assert.equal(job.type, JobType.ARTICLE_PROCESS);
  assert.equal(job.attempts, 0);
  assert.equal(job.maxAttempts, 5);
  assert.deepEqual(job.payload, { articleId: "a1" });
  assert.deepEqual(job.errorHistory, []);
  assert.equal(store.size, 1);
});

test("typed enqueue helpers set dedupeKey and are idempotent for active jobs", async () => {
  const { enqueueArticleProcess, JobType } = await import("@/lib/jobs");
  const first = await enqueueArticleProcess("a1");
  const second = await enqueueArticleProcess("a1");
  assert.equal(first.id, second.id, "second enqueue returns the existing active job");
  assert.equal(first.type, JobType.ARTICLE_PROCESS);
  assert.equal(first.dedupeKey, "article-process:a1");
  assert.equal(store.size, 1, "no duplicate job created");
});

test("enqueue with a dedupeKey re-enqueues a terminal job", async () => {
  const { enqueueArticleProcess, JobStatus } = await import("@/lib/jobs");
  const job = await enqueueArticleProcess("a1");
  // Simulate the job having completed.
  store.get(job.id)!.status = JobStatus.COMPLETED;
  const again = await enqueueArticleProcess("a1");
  assert.equal(again.id, job.id, "reuses the same row");
  assert.equal(again.status, JobStatus.PENDING, "reset to PENDING");
  assert.equal(store.size, 1);
});

test("claimNextJob returns a runnable job and marks it locked", async () => {
  const { claimNextJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "j1", status: JobStatus.PENDING, runAfter: new Date(Date.now() - 1000) });
  const claimed = await claimNextJob("worker-A");
  assert.ok(claimed);
  assert.equal(claimed!.id, "j1");
  assert.equal(claimed!.status, JobStatus.CLAIMED);
  assert.equal(claimed!.lockedBy, "worker-A");
  assert.ok(claimed!.lockedAt instanceof Date);
});

test("claimNextJob skips jobs whose runAfter is in the future", async () => {
  const { claimNextJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "future", status: JobStatus.PENDING, runAfter: new Date(Date.now() + 60_000) });
  assert.equal(await claimNextJob("worker-A"), null);
});

test("claimNextJob honors priority then runAfter ordering", async () => {
  const { claimNextJob } = await import("@/lib/jobs");
  const past = new Date(Date.now() - 10_000);
  seed({ id: "low", priority: 0, runAfter: past });
  seed({ id: "high", priority: 5, runAfter: new Date(Date.now() - 5_000) });
  const claimed = await claimNextJob("worker-A");
  assert.equal(claimed!.id, "high");
});

test("two concurrent claims cannot claim the same job", async () => {
  const { claimNextJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "only", status: JobStatus.PENDING, runAfter: new Date(Date.now() - 1000) });
  const [a, b] = await Promise.all([claimNextJob("worker-A"), claimNextJob("worker-B")]);
  const winners = [a, b].filter((j) => j !== null);
  assert.equal(winners.length, 1, "exactly one worker claims the job");
  assert.equal(winners[0]!.id, "only");
  assert.equal(store.get("only")!.status, JobStatus.CLAIMED);
});

test("sequential claims hand out distinct jobs", async () => {
  const { claimNextJob } = await import("@/lib/jobs");
  const past = new Date(Date.now() - 1000);
  seed({ id: "j1", runAfter: past });
  seed({ id: "j2", runAfter: past });
  const first = await claimNextJob("worker-A");
  const second = await claimNextJob("worker-A");
  assert.notEqual(first!.id, second!.id);
  assert.deepEqual([first!.id, second!.id].sort(), ["j1", "j2"]);
});

test("transient failure increments attempts and schedules a backoff retry", async () => {
  const { failJob, JobStatus } = await import("@/lib/jobs");
  const before = new Date(Date.now() - 1000);
  seed({ id: "j1", status: JobStatus.RUNNING, attempts: 0, maxAttempts: 5, runAfter: before, lockedBy: "w" });
  const now = new Date();
  const updated = await failJob("j1", new Error("provider timeout"), { now });
  assert.equal(updated!.status, JobStatus.FAILED);
  assert.equal(updated!.attempts, 1);
  assert.equal(updated!.lastError, "provider timeout");
  assert.ok((updated!.runAfter as Date).getTime() > now.getTime(), "runAfter pushed into the future");
  assert.equal(updated!.lockedBy, null, "lock released");
  assert.equal((updated!.errorHistory as unknown[]).length, 1);
});

test("permanent failure dead-letters immediately regardless of attempts", async () => {
  const { failJob, JobError, JobStatus } = await import("@/lib/jobs");
  seed({ id: "j1", status: JobStatus.RUNNING, attempts: 0, maxAttempts: 5 });
  const updated = await failJob("j1", new JobError("article gone", { kind: "missing" }));
  assert.equal(updated!.status, JobStatus.DEAD_LETTER);
  assert.equal(updated!.attempts, 1);
  assert.ok(updated!.deadLetteredAt instanceof Date);
  assert.equal(updated!.lastError, "article gone");
});

test("exhausting maxAttempts moves the job to DEAD_LETTER", async () => {
  const { failJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "j1", status: JobStatus.RUNNING, attempts: 0, maxAttempts: 1 });
  const updated = await failJob("j1", new Error("boom"));
  assert.equal(updated!.status, JobStatus.DEAD_LETTER);
  assert.equal(updated!.attempts, 1);
});

test("a stale lock is reclaimable by another worker", async () => {
  const { claimNextJob, JobStatus, DEFAULT_LOCK_TTL_MS } = await import("@/lib/jobs");
  const staleLockedAt = new Date(Date.now() - DEFAULT_LOCK_TTL_MS - 60_000);
  seed({
    id: "stuck",
    status: JobStatus.RUNNING,
    lockedBy: "dead-worker",
    lockedAt: staleLockedAt,
    runAfter: new Date(Date.now() - 1000),
  });
  const claimed = await claimNextJob("worker-B");
  assert.ok(claimed, "stale job reclaimed");
  assert.equal(claimed!.id, "stuck");
  assert.equal(claimed!.status, JobStatus.CLAIMED);
  assert.equal(claimed!.lockedBy, "worker-B");
});

test("a fresh lock is NOT reclaimable", async () => {
  const { claimNextJob, JobStatus } = await import("@/lib/jobs");
  seed({
    id: "busy",
    status: JobStatus.RUNNING,
    lockedBy: "worker-A",
    lockedAt: new Date(),
    runAfter: new Date(Date.now() - 1000),
  });
  assert.equal(await claimNextJob("worker-B"), null);
});

test("completeJob marks COMPLETED and releases the lock", async () => {
  const { completeJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "j1", status: JobStatus.RUNNING, lockedBy: "w", lockedAt: new Date() });
  const done = await completeJob("j1");
  assert.equal(done!.status, JobStatus.COMPLETED);
  assert.ok(done!.completedAt instanceof Date);
  assert.equal(done!.lockedBy, null);
});

test("retryJob re-queues a dead-lettered job", async () => {
  const { retryJob, JobStatus } = await import("@/lib/jobs");
  seed({
    id: "j1",
    status: JobStatus.DEAD_LETTER,
    attempts: 5,
    deadLetteredAt: new Date(),
    lastError: "boom",
  });
  const requeued = await retryJob("j1");
  assert.equal(requeued!.status, JobStatus.PENDING);
  assert.equal(requeued!.attempts, 0);
  assert.equal(requeued!.lastError, null);
  assert.equal(requeued!.deadLetteredAt, null);
});

test("cancelJob dead-letters with a reason", async () => {
  const { cancelJob, JobStatus } = await import("@/lib/jobs");
  seed({ id: "j1", status: JobStatus.PENDING });
  const cancelled = await cancelJob("j1", { reason: "no longer needed" });
  assert.equal(cancelled!.status, JobStatus.DEAD_LETTER);
  assert.equal(cancelled!.lastError, "no longer needed");
});

test("classifyJobError distinguishes permanent from transient", async () => {
  const { classifyJobError, JobError } = await import("@/lib/jobs");
  assert.deepEqual(classifyJobError(new Error("x")).permanent, false);
  assert.equal(classifyJobError(new JobError("v", { kind: "validation" })).permanent, true);
  assert.equal(classifyJobError(new JobError("p", { kind: "provider" })).permanent, false);
  assert.equal(
    classifyJobError(new JobError("force", { kind: "provider", permanent: true })).permanent,
    true,
  );
});

test("countJobsByStatus aggregates the queue", async () => {
  const { countJobsByStatus, JobStatus } = await import("@/lib/jobs");
  seed({ id: "a", status: JobStatus.PENDING });
  seed({ id: "b", status: JobStatus.PENDING });
  seed({ id: "c", status: JobStatus.DEAD_LETTER });
  const counts = await countJobsByStatus();
  assert.equal(counts[JobStatus.PENDING], 2);
  assert.equal(counts[JobStatus.DEAD_LETTER], 1);
});

test("heartbeatJob refreshes the lock only for the owning worker", async () => {
  const { heartbeatJob } = await import("@/lib/jobs");
  const oldLock = new Date(Date.now() - 30_000);
  seed({ id: "j1", lockedBy: "worker-A", lockedAt: oldLock });
  assert.equal(await heartbeatJob("j1", "worker-B"), false, "non-owner cannot heartbeat");
  assert.equal(await heartbeatJob("j1", "worker-A"), true);
  assert.ok((store.get("j1")!.lockedAt as Date).getTime() > oldLock.getTime());
});
