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
      // runWithAiContext is now re-exported from @/lib/ai; provide a pass-through
      // so module instantiation succeeds when the processor imports it.
      runWithAiContext: (_ctx: unknown, fn: () => unknown) => fn(),
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
    lockTtlMs: 60000,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async (_id: string, _wid: string) => ({ status: "RUNNING" }) as unknown as Job,
      heartbeatJob: async () => true,
      completeJob: async (id: string) => {
        completed.push(id);
        return { id } as never;
      },
      failJob: async (id: string, _wid: string, err: unknown) => {
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
    lockTtlMs: 60000,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async (_id: string, _wid: string) => ({ status: "RUNNING" }) as unknown as Job,
      heartbeatJob: async () => true,
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async (id: string, _wid: string, err: unknown) => {
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
    lockTtlMs: 60000,
    logger: silentLogger,
    deps: {
      claimNextJob: async (): Promise<Job | null> => (queue.shift() ?? null) as unknown as Job | null,
      startJob: async (_id: string, _wid: string) => ({ status: "RUNNING" }) as unknown as Job,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async (id: string, _wid: string, err: unknown) => {
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
    lockTtlMs: 60000,
    logger: silentLogger,
    deps: {
      claimNextJob: async () => null,
      startJob: async () => null,
      heartbeatJob: async () => true,
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

test("runJobWorker heartbeat loss aborts handler and skips complete/fail", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let heartbeatCount = 0;
  let handlerAborted = false;
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-hb",
    {
      [JobType.ARTICLE_PROCESS]: async (_job: unknown, ctx: { signal?: AbortSignal }) => {
        // Wait for heartbeat to fire and abort us
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.signal?.aborted) {
              handlerAborted = true;
              clearInterval(check);
              resolve();
            }
          }, 5);
          // Safety timeout
          setTimeout(() => { clearInterval(check); resolve(); }, 200);
        });
      },
    } as never,
    { once: true, heartbeatIntervalMs: 10 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "hb1", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => {
        heartbeatCount++;
        return false; // ownership lost
      },
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async (id: string) => {
        failed.push({ id, error: "should not be called" });
        return null;
      },
    },
  );

  assert.ok(heartbeatCount >= 1, "heartbeat was called");
  assert.ok(handlerAborted, "handler signal was aborted");
  assert.equal(completed.length, 0, "complete not called after ownership loss");
  assert.equal(failed.length, 0, "fail not called after ownership loss");
  assert.equal(stats.completed, 0);
});

test("runJobWorker global stop signal aborts handler", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  const controller = new AbortController();
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-stop",
    {
      [JobType.ARTICLE_PROCESS]: async () => {
        controller.abort();
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    } as never,
    { once: false, signal: controller.signal, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "stop1", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async (id: string) => {
        failed.push({ id, error: "should not be called" });
        return null;
      },
    },
  );

  assert.equal(stats.stoppedBySignal, true);
  assert.equal(completed.length, 0);
});
