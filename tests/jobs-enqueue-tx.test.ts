/**
 * Unit tests for the transaction-aware idempotent enqueue (#1091, Phase 2.1).
 *
 * Uses the in-memory job fake (no DB). Proves: candidate-based ARTICLE_INGEST
 * jobs get the right payload / dedupe key / policy, a replay converges on the
 * single winner (idempotency, AC2), and a TERMINAL job is reused — never reset
 * — by a repeated enqueue (AC3). The upsert-based path never catches P2002.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";
delete process.env.DATABASE_URL;

import { makeJobFake } from "./support/job-fake";
import type { Job } from "@/lib/jobs";

const { prisma: prismaFake, store } = makeJobFake();

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });
});

beforeEach(() => {
  store.clear();
});

async function inTx(fn: (tx: never) => Promise<Job>): Promise<Job> {
  return (await prismaFake.$transaction((tx) => fn(tx as never))) as Job;
}

test("enqueueCandidateIngestInTx creates a PENDING candidate-based ARTICLE_INGEST job", async () => {
  const { enqueueCandidateIngestInTx, JobType, JobStatus } = await import("@/lib/jobs");
  const { CANDIDATE_INGEST_PROCESSING_VERSION } = await import("@/lib/jobs/candidate-ingest");

  const job = await inTx((tx) => enqueueCandidateIngestInTx(tx, "cand-1"));

  assert.equal(job.type, JobType.ARTICLE_INGEST);
  assert.equal(job.status, JobStatus.PENDING);
  assert.equal(job.maxAttempts, 5, "preserves ARTICLE_INGEST retry policy");
  assert.equal(job.attempts, 0);
  assert.deepEqual(job.errorHistory, []);
  assert.equal(job.dedupeKey, "article-ingest:candidate:cand-1:v1");
  assert.deepEqual(job.payload, {
    candidateId: "cand-1",
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
  // Payload is candidate-identity only — no URL / secret / article data (AC4).
  assert.deepEqual(Object.keys(job.payload as object).sort(), ["candidateId", "processingVersion"]);
  assert.equal(store.size, 1);
});

test("re-enqueue of the same candidate converges on one job (idempotent, AC2)", async () => {
  const { enqueueCandidateIngestInTx } = await import("@/lib/jobs");

  const first = await inTx((tx) => enqueueCandidateIngestInTx(tx, "cand-2"));
  const second = await inTx((tx) => enqueueCandidateIngestInTx(tx, "cand-2"));

  assert.equal(first.id, second.id, "second enqueue reuses the winner");
  assert.equal(store.size, 1, "no duplicate job created");
});

test("a TERMINAL job is reused, never reset, by repeated enqueue (AC3)", async () => {
  const { enqueueCandidateIngestInTx, JobStatus } = await import("@/lib/jobs");

  const job = await inTx((tx) => enqueueCandidateIngestInTx(tx, "cand-3"));
  // Simulate the ingest job reaching a terminal state.
  const row = store.get(job.id)!;
  row.status = JobStatus.COMPLETED;
  row.completedAt = new Date();

  const again = await inTx((tx) => enqueueCandidateIngestInTx(tx, "cand-3"));

  assert.equal(again.id, job.id, "reuses the same row");
  assert.equal(again.status, JobStatus.COMPLETED, "terminal job is NOT reset to PENDING");
  assert.equal(store.size, 1);
});

test("enqueueJobInTx preserves priority + runAfter overrides", async () => {
  const { enqueueJobInTx, JobType } = await import("@/lib/jobs");
  const runAfter = new Date("2030-01-01T00:00:00.000Z");

  const job = await inTx((tx) =>
    enqueueJobInTx(tx, JobType.ARTICLE_INGEST, { candidateId: "c", processingVersion: 1 }, "dk-1", {
      priority: 9,
      runAfter,
    }),
  );

  assert.equal(job.priority, 9);
  assert.equal((job.runAfter as Date).getTime(), runAfter.getTime());
  assert.equal(job.dedupeKey, "dk-1");
});
