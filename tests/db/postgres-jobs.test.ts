import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

import { ArticleStatus, JobStatus, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { cleanIntegrationRows, id } from "./support/db-helpers";

afterEach(async () => {
  if (enabled) await cleanIntegrationRows();
});

after(async () => {
  await prisma.$disconnect();
});

test("worker/processor selection uses article state for the derived queue", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const publishedMissingId = id("processor_missing");
  const draftOldId = id("processor_draft_old");
  const draftNewId = id("processor_draft_new");
  const enrichedId = id("processor_enriched");
  const tagId = id("processor_tag");
  const now = new Date();
  const old = new Date(now.getTime() - 60_000);

  await prisma.article.createMany({
    data: [
      {
        id: draftOldId,
        title: "Old Draft",
        content: "Needs processing",
        status: ArticleStatus.DRAFT,
        createdAt: old,
      },
      {
        id: publishedMissingId,
        title: "Published Missing Enrichment",
        content: "Needs backfill",
        status: ArticleStatus.PUBLISHED,
        publishedAt: now,
        createdAt: new Date(now.getTime() - 30_000),
      },
      {
        id: draftNewId,
        title: "New Draft",
        content: "Needs processing",
        status: ArticleStatus.DRAFT,
        createdAt: now,
      },
      {
        id: enrichedId,
        title: "Enriched Published",
        content: "Already enriched",
        status: ArticleStatus.PUBLISHED,
        publishedAt: now,
        createdAt: new Date(now.getTime() - 15_000),
        difficulty: "B1",
        difficultyScore: 42,
      },
    ],
  });
  await prisma.tag.create({ data: { id: tagId, name: `Processor ${tagId}`, slug: tagId } });
  await Promise.all([
    prisma.articleTag.create({ data: { articleId: enrichedId, tagId } }),
    prisma.vocabularyItem.create({ data: { articleId: enrichedId, word: "enriched", explanation: "done", example: "done" } }),
    prisma.quizQuestion.create({ data: { articleId: enrichedId, question: "Done?", options: ["Yes", "No"], correctIndex: 0 } }),
  ]);

  const { listUnprocessedArticleIds } = await import("@/lib/processing/processor");
  const draftsOnly = await listUnprocessedArticleIds();
  assert.deepEqual(
    draftsOnly.filter((articleId) => [draftOldId, draftNewId, publishedMissingId, enrichedId].includes(articleId)),
    [draftOldId, draftNewId],
  );

  const withPublishedBackfill = await listUnprocessedArticleIds({ includePublished: true });
  assert.deepEqual(
    withPublishedBackfill.filter((articleId) => [draftOldId, draftNewId, publishedMissingId, enrichedId].includes(articleId)),
    [draftOldId, publishedMissingId, draftNewId],
  );
});

test("persistent Job table exists with the expected enums", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const jobTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'Job'
  `;
  assert.deepEqual(jobTables, [{ table_name: "Job" }]);

  const jobEnums = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT typname
    FROM pg_type
    WHERE typname IN ('JobType', 'JobStatus')
    ORDER BY typname
  `;
  assert.deepEqual(jobEnums, [{ typname: "JobStatus" }, { typname: "JobType" }]);
});

test("claimNextJob uses FOR UPDATE SKIP LOCKED so concurrent workers never collide", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const { enqueueJob, claimNextJob } = await import("@/lib/jobs");

  const first = await enqueueJob(JobType.PUSH_REMINDER, { n: 1 }, { dedupeKey: id("job_lock_a"), priority: 1 });
  const second = await enqueueJob(JobType.PUSH_REMINDER, { n: 2 }, { dedupeKey: id("job_lock_b"), priority: 1 });

  // Two workers claim concurrently. SKIP LOCKED guarantees they take different rows.
  const [claimA, claimB] = await Promise.all([
    claimNextJob("worker-a"),
    claimNextJob("worker-b"),
  ]);

  assert.ok(claimA, "worker-a should claim a job");
  assert.ok(claimB, "worker-b should claim a job");
  assert.notEqual(claimA.id, claimB.id, "two workers must not claim the same job");
  assert.deepEqual(
    [claimA.id, claimB.id].sort(),
    [first.id, second.id].sort(),
  );
  assert.equal(claimA.status, JobStatus.CLAIMED);
  assert.equal(claimB.status, JobStatus.CLAIMED);
  assert.equal(claimA.lockedBy, "worker-a");
  assert.equal(claimB.lockedBy, "worker-b");

  // Queue drained: a third claim finds nothing runnable.
  const empty = await claimNextJob("worker-c");
  assert.equal(empty, null);
});

test("claimNextJob recovers a stale lock once the TTL elapses", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const { enqueueJob, claimNextJob, DEFAULT_LOCK_TTL_MS } = await import("@/lib/jobs");

  const t0 = new Date();
  const job = await enqueueJob(JobType.PUSH_REMINDER, { stale: true }, { dedupeKey: id("job_stale") });

  const claimed = await claimNextJob("worker-1", { now: t0 });
  assert.ok(claimed, "worker-1 should claim the job");
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.lockedBy, "worker-1");

  // Still within the lease: a second worker cannot steal the fresh lock.
  const tooEarly = await claimNextJob("worker-2", { now: new Date(t0.getTime() + 1_000) });
  assert.equal(tooEarly, null);

  // Past the lease: the stale lock is reclaimable by another worker.
  const reclaimed = await claimNextJob("worker-2", {
    now: new Date(t0.getTime() + DEFAULT_LOCK_TTL_MS + 1_000),
  });
  assert.ok(reclaimed, "worker-2 should reclaim the stale job");
  assert.equal(reclaimed.id, job.id);
  assert.equal(reclaimed.lockedBy, "worker-2");
});

test("failJob moves an exhausted job to the dead-letter queue", { skip: !enabled }, async () => {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");

  const { enqueueJob, claimNextJob, failJob, JobError, listDeadLetterJobs } = await import("@/lib/jobs");

  const job = await enqueueJob(JobType.PUSH_REMINDER, { boom: true }, {
    dedupeKey: id("job_dlq"),
    maxAttempts: 1,
  });

  const claimed = await claimNextJob("worker-dlq");
  assert.ok(claimed, "should claim the job");

  const failed = await failJob(claimed.id, new JobError("provider exploded", { kind: "provider" }));
  assert.ok(failed, "failJob should return the updated job");
  assert.equal(failed.status, JobStatus.DEAD_LETTER, "exhausted attempts must dead-letter");
  assert.equal(failed.lastError, "provider exploded");
  assert.ok(failed.deadLetteredAt, "deadLetteredAt should be set");

  const dlq = await listDeadLetterJobs();
  assert.ok(dlq.some((entry) => entry.id === job.id), "dead-letter listing should include the job");
});
