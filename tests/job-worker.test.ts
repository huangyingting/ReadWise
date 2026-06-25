import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ArticleProcessResult } from "@/lib/processing/processor";
import type { Job } from "@/lib/jobs";

process.env.LOG_LEVEL = "error";

// Importing "@/lib/worker" pulls the processor → translation → ai import chain;
// mock prisma + ai so module evaluation never touches a real DB / provider.
before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => false,
      aiModelName: () => null,
      chatComplete: async () => null,
    },
  });
});

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

type FakeJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
};

function job(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: "j1",
    type: "ARTICLE_PROCESS",
    status: "CLAIMED",
    attempts: 0,
    payload: { articleId: "a1" },
    ...overrides,
  };
}

let completed: string[];
let failed: { id: string; error: string }[];

beforeEach(() => {
  completed = [];
  failed = [];
});

test("runJobWorker drains claimed jobs and completes successful ones", async () => {
  const { runJobWorker } = await import("@/lib/worker");
  const queue: (FakeJob | null)[] = [job({ id: "j1" }), job({ id: "j2", payload: { articleId: "a2" } }), null];

  const stats = await runJobWorker({
    once: true,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async () => null,
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async (id: string, err: unknown) => {
        failed.push({ id, error: String(err) });
        return null;
      },
      processArticle: async (articleId: string): Promise<ArticleProcessResult> => ({
        articleId,
        title: articleId,
        ok: true,
        published: true,
        steps: [],
      }),
      sleep: async () => {},
    },
  });

  assert.deepEqual(completed.sort(), ["j1", "j2"]);
  assert.equal(stats.completed, 2);
  assert.equal(stats.failed, 0);
  assert.equal(failed.length, 0);
});

test("runJobWorker fails a job whose processing step fails (transient)", async () => {
  const { runJobWorker } = await import("@/lib/worker");
  const { JobStatus } = await import("@/lib/jobs");
  const queue: (FakeJob | null)[] = [job({ id: "bad" }), null];

  const stats = await runJobWorker({
    once: true,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async () => null,
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async (id: string, err: unknown) => {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
        return { status: JobStatus.FAILED } as never;
      },
      processArticle: async (articleId: string): Promise<ArticleProcessResult> => ({
        articleId,
        title: articleId,
        ok: false,
        published: false,
        steps: [{ step: "tags", status: "failed", detail: "boom" }],
      }),
      sleep: async () => {},
    },
  });

  assert.equal(completed.length, 0);
  assert.equal(stats.failed, 1);
  assert.equal(stats.retried, 1);
  assert.equal(stats.deadLettered, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /processing failed/);
});

test("runJobWorker dead-letters a job for a missing article (permanent)", async () => {
  const { runJobWorker } = await import("@/lib/worker");
  const { JobStatus } = await import("@/lib/jobs");
  const queue: (FakeJob | null)[] = [job({ id: "missing" }), null];

  const stats = await runJobWorker({
    once: true,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async () => null,
      completeJob: async () => null,
      failJob: async (id: string, err: unknown) => {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
        return { status: JobStatus.DEAD_LETTER } as never;
      },
      processArticle: async (): Promise<ArticleProcessResult | null> => null,
      sleep: async () => {},
    },
  });

  assert.equal(stats.failed, 1);
  assert.equal(stats.deadLettered, 1);
  assert.equal(stats.retried, 0);
  assert.match(failed[0].error, /not found/);
});

test("runJobWorker stops when the queue is empty in once mode", async () => {
  const { runJobWorker } = await import("@/lib/worker");
  const stats = await runJobWorker({
    once: true,
    logger: silentLogger,
    deps: {
      claimNextJob: async () => null,
      startJob: async () => null,
      completeJob: async () => null,
      failJob: async () => null,
      processArticle: async (articleId: string): Promise<ArticleProcessResult> => ({
        articleId,
        title: articleId,
        ok: true,
        published: false,
        steps: [],
      }),
      sleep: async () => {},
    },
  });
  assert.equal(stats.claimed, 0);
  assert.equal(stats.completed, 0);
});
