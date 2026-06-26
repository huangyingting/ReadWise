import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Silence structured request logs emitted by the jobs module.
process.env.LOG_LEVEL = "error";
// Force the SQLite/generic claim path (no FOR UPDATE SKIP LOCKED) in tests.
delete process.env.DATABASE_URL;

import { makeJobFake } from "./support/job-fake";

const { prisma: prismaFake, seed, store } = makeJobFake();

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });
});

beforeEach(() => {
  store.clear();
});

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
