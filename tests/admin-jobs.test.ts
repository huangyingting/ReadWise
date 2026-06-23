/**
 * Unit tests for src/lib/admin-jobs.ts (RW-017).
 *
 * Covers the read-side listing (filter → Prisma `where` mapping, pagination) and
 * the admin action guards in `runJobAction` (which transitions are allowed for a
 * given job status). `@/lib/prisma` and `@/lib/jobs` are mocked — no DB.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type FindManyArgs = {
  where: Record<string, unknown>;
  skip: number;
  take: number;
};

// ---- prisma stubs --------------------------------------------------------
let findManyArgs: FindManyArgs | null = null;
let countResult = 0;
let findManyResult: Record<string, unknown>[] = [];

// ---- jobs stubs ----------------------------------------------------------
let stubJob: { id: string; status: string; type: string } | null = null;
let retryCalls: string[] = [];
let cancelCalls: string[] = [];
let archiveCalls: string[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        job: {
          count: async () => countResult,
          findMany: async (args: FindManyArgs) => {
            findManyArgs = args;
            return findManyResult;
          },
        },
      },
    },
  });

  mock.module("@/lib/jobs", {
    namedExports: {
      DEFAULT_LOCK_TTL_MS: 600_000,
      TERMINAL_STATUSES: ["COMPLETED", "DEAD_LETTER"],
      getJob: async () => stubJob,
      retryJob: async (id: string) => {
        retryCalls.push(id);
        return { id, status: "PENDING", type: "ARTICLE_PROCESS" };
      },
      cancelJob: async (id: string) => {
        cancelCalls.push(id);
        return { id, status: "DEAD_LETTER", type: "ARTICLE_PROCESS" };
      },
      archiveJob: async (id: string) => {
        archiveCalls.push(id);
        return { id, status: "COMPLETED", type: "ARTICLE_PROCESS" };
      },
      countJobsByStatus: async () => ({ PENDING: 2, FAILED: 1 }),
      countJobsByType: async () => ({ ARTICLE_PROCESS: 3 }),
      listJobs: async () => [],
    },
  });
});

beforeEach(() => {
  findManyArgs = null;
  countResult = 0;
  findManyResult = [];
  stubJob = null;
  retryCalls = [];
  cancelCalls = [];
  archiveCalls = [];
});

function jobRow(partial: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    id: "job-1",
    type: "ARTICLE_PROCESS",
    status: "PENDING",
    payload: { articleId: "article-1", feature: "tags" },
    attempts: 0,
    maxAttempts: 5,
    priority: 0,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    dedupeKey: "backfill:tags:article-1",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    deadLetteredAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// ---- listAdminJobs -------------------------------------------------------

test("listAdminJobs maps status/type/articleId/reason filters to a Prisma where", async () => {
  countResult = 1;
  findManyResult = [jobRow()];
  const { listAdminJobs } = await import("@/lib/admin-jobs");

  const result = await listAdminJobs({
    status: "failed",
    type: "article_process",
    articleId: "article-1",
    failureReason: "timeout",
    page: 1,
  });

  assert.ok(findManyArgs);
  assert.equal(findManyArgs!.where.status, "FAILED");
  assert.equal(findManyArgs!.where.type, "ARTICLE_PROCESS");
  assert.deepEqual(findManyArgs!.where.dedupeKey, { contains: "article-1" });
  assert.deepEqual(findManyArgs!.where.lastError, { contains: "timeout" });
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].articleId, "article-1");
  assert.equal(result.jobs[0].feature, "tags");
});

test("listAdminJobs stuck filter queries in-flight jobs with an old lock", async () => {
  findManyResult = [];
  const { listAdminJobs } = await import("@/lib/admin-jobs");
  await listAdminJobs({ stuck: true });

  assert.ok(findManyArgs);
  assert.deepEqual(findManyArgs!.where.status, { in: ["CLAIMED", "RUNNING"] });
  assert.ok(findManyArgs!.where.lockedAt, "stuck filter must constrain lockedAt");
});

test("listAdminJobs ignores unknown status/type filters", async () => {
  const { listAdminJobs } = await import("@/lib/admin-jobs");
  await listAdminJobs({ status: "bogus", type: "nope" });

  assert.ok(findManyArgs);
  assert.equal(findManyArgs!.where.status, undefined);
  assert.equal(findManyArgs!.where.type, undefined);
});

test("listAdminJobs paginates with the configured page size", async () => {
  countResult = 60;
  const { listAdminJobs, ADMIN_JOBS_PAGE_SIZE } = await import("@/lib/admin-jobs");
  const result = await listAdminJobs({ page: 2 });

  assert.equal(findManyArgs!.skip, ADMIN_JOBS_PAGE_SIZE);
  assert.equal(findManyArgs!.take, ADMIN_JOBS_PAGE_SIZE);
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, Math.ceil(60 / ADMIN_JOBS_PAGE_SIZE));
});

// ---- runJobAction guards -------------------------------------------------

test("runJobAction returns 404 for a missing job", async () => {
  stubJob = null;
  const { runJobAction } = await import("@/lib/admin-jobs");
  const res = await runJobAction("missing", "retry");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 404);
});

test("runJobAction retry only allows FAILED / DEAD_LETTER", async () => {
  const { runJobAction } = await import("@/lib/admin-jobs");

  stubJob = { id: "job-1", status: "PENDING", type: "ARTICLE_PROCESS" };
  const blocked = await runJobAction("job-1", "retry");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 409);
  assert.equal(retryCalls.length, 0);

  stubJob = { id: "job-1", status: "FAILED", type: "ARTICLE_PROCESS" };
  const ok = await runJobAction("job-1", "retry");
  assert.equal(ok.ok, true);
  assert.deepEqual(retryCalls, ["job-1"]);
});

test("runJobAction cancel rejects terminal jobs", async () => {
  const { runJobAction } = await import("@/lib/admin-jobs");

  stubJob = { id: "job-1", status: "COMPLETED", type: "ARTICLE_PROCESS" };
  const blocked = await runJobAction("job-1", "cancel");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 409);
  assert.equal(cancelCalls.length, 0);

  stubJob = { id: "job-1", status: "RUNNING", type: "ARTICLE_PROCESS" };
  const ok = await runJobAction("job-1", "cancel");
  assert.equal(ok.ok, true);
  assert.deepEqual(cancelCalls, ["job-1"]);
});

test("runJobAction archive only allows terminal jobs", async () => {
  const { runJobAction } = await import("@/lib/admin-jobs");

  stubJob = { id: "job-1", status: "RUNNING", type: "ARTICLE_PROCESS" };
  const blocked = await runJobAction("job-1", "archive");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.status, 409);
  assert.equal(archiveCalls.length, 0);

  stubJob = { id: "job-1", status: "DEAD_LETTER", type: "ARTICLE_PROCESS" };
  const ok = await runJobAction("job-1", "archive");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.previousStatus, "DEAD_LETTER");
  assert.deepEqual(archiveCalls, ["job-1"]);
});
