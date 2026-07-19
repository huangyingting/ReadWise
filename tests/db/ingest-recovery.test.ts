/**
 * Candidate/Job ingest-recovery integration tests (#1093, Phase 2.3).
 *
 * Engine-agnostic like `page-commit.test.ts` / `candidate-ingest-enqueue.test.ts`:
 * runs on SQLite by default under `npm run test:db` and on PostgreSQL in CI,
 * guarded by `enabled` (RUN_DB_INTEGRATION=1). Exercises the REAL guarded-tx
 * persistence (`applyIngestClassification`, `reactivateCandidate`,
 * `reactivateEligibleCandidates`) against the live database and proves:
 *
 *   - AC2: an exhausted/deterministic failure reaches the ONE visible QUARANTINED
 *     state (candidate) with its Job dead-lettered — atomically.
 *   - AC3: extractor-version reactivation enqueues a NEW ARTICLE_INGEST job on a
 *     BUMPED processing-version dedupe key while the prior terminal Job stays
 *     intact for audit; budget bounds the batch; ineligible candidates are skipped.
 *   - AC4: the guarded Job transition requires the current RUNNING owner, so a
 *     stale worker whose lock was reclaimed rolls back the whole transaction
 *     (candidate + Job both unchanged) — deterministic under restart + reclaim.
 *   - Governing invariant: a known Article (articleId set) / baseline identity is
 *     never retried, quarantined, or reactivated.
 *
 * Candidates use the PREFIX-scoped provider key so the shared sweep removes them;
 * a local afterEach deletes the candidate-keyed ingest Jobs (keyed on the cuid,
 * not the PREFIX) and any Articles created here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { CrawlCandidateStatus, JobStatus, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/lib/jobs";
import {
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
} from "@/lib/jobs/candidate-ingest";
import {
  applyIngestClassification,
  reactivateCandidate,
  reactivateEligibleCandidates,
} from "@/lib/scraper/incremental/ingest-recovery";
import { INGEST_FAILURE_REASON } from "@/lib/scraper/incremental/ingest-outcome";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const candidateIds = new Set<string>();
const articleIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const ids = [...candidateIds];
  for (const id of ids) {
    await prisma.job.deleteMany({
      where: { dedupeKey: { startsWith: `article-ingest:candidate:${id}:` } },
    });
  }
  if (ids.length > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { id: { in: ids } } });
  }
  if (articleIds.size > 0) {
    await prisma.article.deleteMany({ where: { id: { in: [...articleIds] } } });
  }
  candidateIds.clear();
  articleIds.clear();
});

async function mkCandidate(overrides: Record<string, unknown> = {}) {
  const c = await createCrawlCandidate({
    provisionalKey: `v1:dbit:${randomUUID()}`,
    ...overrides,
  });
  candidateIds.add(c.id);
  return c;
}

/** Creates a RUNNING candidate-ingest Job locked by `workerId` for a candidate. */
async function mkRunningIngestJob(candidateId: string, workerId: string, version = 1) {
  const now = new Date();
  return prisma.job.create({
    data: {
      type: JobType.ARTICLE_INGEST,
      status: JobStatus.RUNNING,
      payload: buildCandidateIngestPayload(candidateId, version),
      errorHistory: [],
      attempts: 1,
      maxAttempts: 5,
      lockedBy: workerId,
      lockedAt: now,
      startedAt: now,
      dedupeKey: candidateIngestDedupeKey(candidateId, version),
    },
  });
}

const NOW = new Date("2026-07-19T12:00:00.000Z");

test("AC2: exhausted transient failure quarantines the candidate AND dead-letters the Job atomically", { skip: !enabled }, async () => {
  const c = await mkCandidate({ ingestAttemptCount: 4 });
  const job = await mkRunningIngestJob(c.id, "worker-A");

  const result = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "quarantine-on-exhaustion", reason: INGEST_FAILURE_REASON.HTTP_5XX },
    now: NOW,
    extractorVersion: 1,
    job: { jobId: job.id, workerId: "worker-A" },
  });
  assert.deepEqual(result, { applied: "quarantine" });

  const reloaded = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(reloaded.status, CrawlCandidateStatus.QUARANTINED);
  assert.equal(reloaded.lastFailureReason, INGEST_FAILURE_REASON.HTTP_5XX);
  assert.equal(reloaded.terminalReason, INGEST_FAILURE_REASON.HTTP_5XX);
  assert.ok(reloaded.terminalAt);
  assert.equal(reloaded.nextAttemptAt, null);
  assert.equal(reloaded.ingestAttemptCount, 5);

  const jobAfter = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(jobAfter.status, JobStatus.DEAD_LETTER);
  assert.equal(jobAfter.lockedBy, null);
  assert.equal(jobAfter.lastError, INGEST_FAILURE_REASON.HTTP_5XX);
});

test("permanent failure moves the candidate to REJECTED and dead-letters the Job", { skip: !enabled }, async () => {
  const c = await mkCandidate();
  const job = await mkRunningIngestJob(c.id, "worker-A");

  const result = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "terminal", reason: INGEST_FAILURE_REASON.HTTP_410_GONE },
    now: NOW,
    extractorVersion: 1,
    job: { jobId: job.id, workerId: "worker-A" },
  });
  assert.deepEqual(result, { applied: "terminal" });

  const reloaded = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(reloaded.status, CrawlCandidateStatus.REJECTED);
  assert.equal(reloaded.terminalReason, INGEST_FAILURE_REASON.HTTP_410_GONE);
  assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status, JobStatus.DEAD_LETTER);
});

test("AC1: a retry keeps the candidate recoverable and reschedules the Job to runAfter", { skip: !enabled }, async () => {
  const c = await mkCandidate();
  const job = await mkRunningIngestJob(c.id, "worker-A");
  const nextAttemptAt = new Date(NOW.getTime() + 120_000);

  const result = await applyIngestClassification({
    candidateId: c.id,
    classification: {
      disposition: "retry",
      reason: INGEST_FAILURE_REASON.HTTP_404_PRE_PROPAGATION,
      nextAttemptAt,
    },
    now: NOW,
    extractorVersion: 1,
    job: { jobId: job.id, workerId: "worker-A" },
  });
  assert.deepEqual(result, { applied: "retry" });

  const reloaded = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(reloaded.status, CrawlCandidateStatus.DISCOVERED, "still recoverable");
  assert.equal(reloaded.ingestAttemptCount, 1);
  assert.equal(reloaded.nextAttemptAt?.getTime(), nextAttemptAt.getTime());
  assert.ok(reloaded.firstIngestAttemptAt, "grace anchor seeded");

  const jobAfter = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(jobAfter.status, JobStatus.FAILED);
  assert.equal(jobAfter.runAfter.getTime(), nextAttemptAt.getTime());
  assert.equal(jobAfter.lockedBy, null);
});

test("governing invariant: a known-Article candidate is never touched", { skip: !enabled }, async () => {
  const article = await prisma.article.create({
    data: { id: `dbit_article_${randomUUID().replace(/-/g, "")}`, title: "Known", content: "Body." },
  });
  articleIds.add(article.id);
  const c = await mkCandidate({ articleId: article.id, status: CrawlCandidateStatus.INGESTED });

  const result = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "quarantine-on-exhaustion", reason: INGEST_FAILURE_REASON.HTTP_5XX },
    now: NOW,
    extractorVersion: 1,
  });
  assert.deepEqual(result, { skipped: "invariant" });

  const reloaded = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(reloaded.status, CrawlCandidateStatus.INGESTED, "unchanged");
  assert.equal(reloaded.lastFailureReason, null);
});

test("governing invariant: a baseline-observed candidate is never quarantined", { skip: !enabled }, async () => {
  const c = await mkCandidate({ observedInBaseline: true, status: CrawlCandidateStatus.BASELINE });
  const result = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "quarantine-on-exhaustion", reason: INGEST_FAILURE_REASON.HTTP_5XX },
    now: NOW,
    extractorVersion: 1,
  });
  assert.deepEqual(result, { skipped: "invariant" });
  assert.equal(
    (await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } })).status,
    CrawlCandidateStatus.BASELINE,
  );
});

test("AC4: a stale (non-owner) worker cannot finalize — candidate + Job both roll back", { skip: !enabled }, async () => {
  const c = await mkCandidate();
  const job = await mkRunningIngestJob(c.id, "worker-OWNER");

  // A reclaiming worker "worker-STALE" tries to quarantine while it does NOT own
  // the lock (owner is "worker-OWNER"): the guarded Job update matches 0 rows.
  const stale = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "quarantine-on-exhaustion", reason: INGEST_FAILURE_REASON.HTTP_5XX },
    now: NOW,
    extractorVersion: 1,
    job: { jobId: job.id, workerId: "worker-STALE" },
  });
  assert.deepEqual(stale, { skipped: "conflict" });

  // The whole transaction rolled back: candidate is untouched, Job still RUNNING.
  const candAfter = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(candAfter.status, CrawlCandidateStatus.DISCOVERED);
  assert.equal(candAfter.lastFailureReason, null);
  const jobAfter = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(jobAfter.status, JobStatus.RUNNING);
  assert.equal(jobAfter.lockedBy, "worker-OWNER");

  // The true owner applies deterministically.
  const owner = await applyIngestClassification({
    candidateId: c.id,
    classification: { disposition: "quarantine-on-exhaustion", reason: INGEST_FAILURE_REASON.HTTP_5XX },
    now: NOW,
    extractorVersion: 1,
    job: { jobId: job.id, workerId: "worker-OWNER" },
  });
  assert.deepEqual(owner, { applied: "quarantine" });
  assert.equal(
    (await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } })).status,
    CrawlCandidateStatus.QUARANTINED,
  );
});

test("AC3: reactivation enqueues a NEW bumped-version Job and preserves the prior terminal Job", { skip: !enabled }, async () => {
  const c = await mkCandidate({
    status: CrawlCandidateStatus.QUARANTINED,
    lastFailureReason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE,
    terminalReason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE,
    extractorVersion: 1,
    ingestAttemptCount: 5,
  });
  // Prior terminal Job on the ORIGINAL (v1) dedupe key — audit history.
  const oldJob = await prisma.job.create({
    data: {
      type: JobType.ARTICLE_INGEST,
      status: JobStatus.DEAD_LETTER,
      payload: buildCandidateIngestPayload(c.id, 1),
      errorHistory: [],
      attempts: 5,
      maxAttempts: 5,
      deadLetteredAt: new Date(),
      dedupeKey: candidateIngestDedupeKey(c.id, 1),
    },
  });

  const result = await reactivateCandidate(c.id, 2, NOW);
  assert.equal(result.reactivated, true);
  if (!result.reactivated) return;
  assert.equal(result.processingVersion, 2);
  assert.equal(result.dedupeKey, candidateIngestDedupeKey(c.id, 2));

  const reloaded = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(reloaded.status, CrawlCandidateStatus.DISCOVERED, "back to recoverable");
  assert.equal(reloaded.extractorVersion, 2);
  assert.equal(reloaded.processingVersion, "2");
  assert.equal(reloaded.ingestAttemptCount, 0, "attempt metadata reset for the fresh version");
  assert.equal(reloaded.lastFailureReason, null);

  const newJob = await prisma.job.findUniqueOrThrow({
    where: { dedupeKey: candidateIngestDedupeKey(c.id, 2) },
  });
  assert.equal(newJob.status, JobStatus.PENDING);
  assert.notEqual(newJob.id, oldJob.id, "a NEW job, not the reset old one");

  const oldReloaded = await prisma.job.findUniqueOrThrow({ where: { id: oldJob.id } });
  assert.equal(oldReloaded.status, JobStatus.DEAD_LETTER, "prior terminal Job preserved for audit");
});

test("AC3: reactivation is refused for ineligible candidates (transient reason / known Article)", { skip: !enabled }, async () => {
  const transient = await mkCandidate({
    status: CrawlCandidateStatus.QUARANTINED,
    lastFailureReason: INGEST_FAILURE_REASON.HTTP_5XX, // network transient, not extraction/quality
    extractorVersion: 1,
  });
  assert.deepEqual(await reactivateCandidate(transient.id, 2, NOW), {
    reactivated: false,
    reason: "ineligible",
  });
  assert.equal(
    await prisma.job.findUnique({ where: { dedupeKey: candidateIngestDedupeKey(transient.id, 2) } }),
    null,
    "no new job enqueued",
  );
});

test("AC3: batch reactivation obeys the bounded budget", { skip: !enabled }, async () => {
  const made = [];
  for (let i = 0; i < 3; i += 1) {
    made.push(
      await mkCandidate({
        status: CrawlCandidateStatus.QUARANTINED,
        lastFailureReason: INGEST_FAILURE_REASON.QUALITY_REJECTED,
        extractorVersion: 1,
        firstObservedAt: new Date(NOW.getTime() + i * 1000),
      }),
    );
  }
  // An ineligible one that must never be selected.
  await mkCandidate({
    status: CrawlCandidateStatus.QUARANTINED,
    lastFailureReason: INGEST_FAILURE_REASON.HTTP_429,
    extractorVersion: 1,
  });

  const summary = await reactivateEligibleCandidates(2, 2, NOW);
  assert.equal(summary.reactivated, 2, "budget caps the batch at 2");

  const newJobs = await prisma.job.count({
    where: {
      OR: made.map((c) => ({ dedupeKey: candidateIngestDedupeKey(c.id, 2) })),
    },
  });
  assert.equal(newJobs, 2, "exactly two new bumped-version jobs enqueued");
});
