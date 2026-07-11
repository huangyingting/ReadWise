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

// ─── Coverage for defensive branches (L101-106, L200-203, L237-240, L266-268, L287-290) ───

test("heartbeat dependency throws → ownership loss, handler aborted, no stale complete/fail", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let handlerAborted = false;
  let claimed = false;
  const warns: string[] = [];

  const stats = await runWorkerLoop(
    "worker-hb-err",
    {
      [JobType.ARTICLE_PROCESS]: async (_job: unknown, ctx: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.signal?.aborted) {
              handlerAborted = true;
              clearInterval(check);
              resolve();
            }
          }, 5);
          setTimeout(() => { clearInterval(check); resolve(); }, 300);
        });
      },
    } as never,
    { once: true, heartbeatIntervalMs: 10 },
    { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "hb-throw", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => { throw new Error("DB connection lost"); },
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

  assert.ok(handlerAborted, "handler signal was aborted on heartbeat throw");
  assert.equal(completed.length, 0, "complete not called after heartbeat error");
  assert.equal(failed.length, 0, "fail not called after heartbeat error");
  assert.ok(warns.some((w) => w.includes("heartbeat error")), "logged heartbeat error");
  assert.equal(stats.completed, 0);
});

test("startJob CAS returns null → handler does not run, loop continues", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let handlerRan = false;
  let claimCount = 0;

  const stats = await runWorkerLoop(
    "worker-start-cas",
    {
      [JobType.ARTICLE_PROCESS]: async () => { handlerRan = true; },
    } as never,
    { once: true, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => {
        claimCount++;
        if (claimCount === 1) {
          return { id: "cas-start", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
        }
        return null;
      },
      startJob: async () => null, // CAS rejected
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

  assert.equal(handlerRan, false, "handler must not run when startJob CAS fails");
  assert.equal(completed.length, 0, "complete not called");
  assert.equal(failed.length, 0, "fail not called");
  assert.equal(stats.claimed, 1, "claim counted but no completion");
  assert.equal(stats.completed, 0);
});

test("completeJob CAS returns null → ownership-loss log, no stats.completed", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  const warns: string[] = [];
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-complete-cas",
    {
      [JobType.ARTICLE_PROCESS]: async () => { /* success */ },
    } as never,
    { once: true, heartbeatIntervalMs: 50000 },
    { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "cas-complete", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async () => null, // CAS rejected
      failJob: async (id: string) => {
        failed.push({ id, error: "should not be called" });
        return null;
      },
    },
  );

  assert.equal(stats.completed, 0, "completed stat not incremented on CAS reject");
  assert.ok(warns.some((w) => w.includes("complete CAS rejected")), "logged ownership loss");
  assert.equal(failed.length, 0, "fail not called");
});

test("failJob CAS returns null → ownership-loss log, no stats.failed update", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  const warns: string[] = [];
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-fail-cas",
    {
      [JobType.ARTICLE_PROCESS]: async () => { throw new Error("handler boom"); },
    } as never,
    { once: true, heartbeatIntervalMs: 50000 },
    { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "cas-fail", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async () => null, // CAS rejected
    },
  );

  assert.equal(stats.failed, 0, "failed stat not incremented on CAS reject");
  assert.ok(warns.some((w) => w.includes("fail CAS rejected")), "logged ownership loss");
});

test("handler throws after heartbeat ownership loss → no failJob, no unhandled rejection", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let claimed = false;
  const warns: string[] = [];
  let failCalled = false;

  const stats = await runWorkerLoop(
    "worker-throw-after-loss",
    {
      [JobType.ARTICLE_PROCESS]: async (_job: unknown, ctx: { signal?: AbortSignal }) => {
        // Wait for heartbeat to fire and lose ownership
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.signal?.aborted) {
              clearInterval(check);
              resolve();
            }
          }, 5);
          setTimeout(() => { clearInterval(check); resolve(); }, 300);
        });
        // Throw a real (non-Abort) error after ownership is lost
        throw new Error("handler late failure");
      },
    } as never,
    { once: true, heartbeatIntervalMs: 10 },
    { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "late-throw", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => false, // ownership lost immediately
      completeJob: async (id: string) => {
        completed.push(id);
        return null;
      },
      failJob: async () => {
        failCalled = true;
        return null;
      },
    },
  );

  assert.equal(failCalled, false, "failJob must not be called when ownership is lost");
  assert.equal(completed.length, 0, "complete not called");
  assert.ok(warns.some((w) => w.includes("handler error after ownership loss")), "logged ownership loss path");
  assert.equal(stats.completed, 0);
  assert.equal(stats.failed, 0);
});

test("heartbeat succeeds and reschedules before handler completes", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let claimed = false;
  let heartbeatCount = 0;

  const stats = await runWorkerLoop(
    "worker-hb-sched",
    {
      [JobType.ARTICLE_PROCESS]: async () => {
        // Give heartbeat time to fire and succeed at least twice
        await new Promise((r) => setTimeout(r, 50));
      },
    } as never,
    { once: true, heartbeatIntervalMs: 10 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "sched1", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => { heartbeatCount++; return true; },
      completeJob: async () => ({ id: "sched1" }) as never,
      failJob: async () => null,
    },
  );

  assert.ok(heartbeatCount >= 2, `heartbeat fired ${heartbeatCount} times`);
  assert.equal(stats.completed, 1);
});

test("loop exits immediately when signal is already aborted", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const controller = new AbortController();
  controller.abort();

  const stats = await runWorkerLoop(
    "worker-pre-abort",
    {} as never,
    { signal: controller.signal },
    silentLogger,
    {
      claimNextJob: async () => { throw new Error("should not be called"); },
      startJob: async () => null,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async () => null,
    },
  );

  assert.equal(stats.stoppedBySignal, true);
  assert.equal(stats.polls, 0);
});

test("non-once mode: no job → sleep → poll again, then drains on signal", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  const controller = new AbortController();
  let pollCount = 0;
  let sleepCalled = false;

  const stats = await runWorkerLoop(
    "worker-poll",
    {
      [JobType.ARTICLE_PROCESS]: async () => {},
    } as never,
    { once: false, signal: controller.signal, pollIntervalMs: 10, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => {
        pollCount++;
        if (pollCount === 1) return null; // first poll empty → sleep
        if (pollCount === 2) {
          return { id: "poll2", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
        }
        controller.abort();
        return null;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async () => ({ id: "poll2" }) as never,
      failJob: async () => null,
      sleep: async () => { sleepCalled = true; },
    },
  );

  assert.ok(sleepCalled, "sleep was called for empty poll");
  assert.equal(stats.completed, 1);
  assert.equal(stats.stoppedBySignal, true);
});

test("no handler registered for job type throws validation error → failJob", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  let claimed = false;
  let failedError = "";

  const stats = await runWorkerLoop(
    "worker-no-handler",
    {} as never, // no handlers registered
    { once: true, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "nh1", type: "UNKNOWN_TYPE", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async (_id: string, _wid: string, err: unknown) => {
        failedError = err instanceof Error ? err.message : String(err);
        return { status: "FAILED" } as never;
      },
    },
  );

  assert.match(failedError, /no handler registered/);
  assert.equal(stats.failed, 1);
});

test("ownershipLost + global signal aborted in catch → break with stoppedBySignal", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  const controller = new AbortController();
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-loss-stop",
    {
      [JobType.ARTICLE_PROCESS]: async (_job: unknown, ctx: { signal?: AbortSignal }) => {
        // Wait for heartbeat loss
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.signal?.aborted) { clearInterval(check); resolve(); }
          }, 5);
          setTimeout(() => { clearInterval(check); resolve(); }, 300);
        });
        // Now fire global stop too
        controller.abort();
        // Throw an abort error (simulates handler reacting to abort)
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    } as never,
    { once: false, signal: controller.signal, heartbeatIntervalMs: 10 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "loss-stop", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => false,
      completeJob: async () => null,
      failJob: async () => null,
    },
  );

  assert.equal(stats.stoppedBySignal, true);
});

test("handler aborted (ownership lost) via AbortError covers isAbort path", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let claimed = false;
  const warns: string[] = [];

  const stats = await runWorkerLoop(
    "worker-abort-loss",
    {
      [JobType.ARTICLE_PROCESS]: async (_job: unknown, ctx: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (ctx.signal?.aborted) { clearInterval(check); resolve(); }
          }, 5);
          setTimeout(() => { clearInterval(check); resolve(); }, 300);
        });
        // Throw AbortError after ownership loss
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    } as never,
    { once: true, heartbeatIntervalMs: 10 },
    { info: () => {}, warn: (msg: string) => { warns.push(msg); }, error: () => {} },
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "abort-loss", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => false,
      completeJob: async () => null,
      failJob: async () => null,
    },
  );

  assert.ok(warns.some((w) => w.includes("handler aborted (ownership lost)")));
  assert.equal(stats.completed, 0);
  assert.equal(stats.failed, 0);
});

test("handler throws AbortError on its own (no signal, no heartbeat loss) → stops loop", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");
  let claimed = false;

  const stats = await runWorkerLoop(
    "worker-self-abort",
    {
      [JobType.ARTICLE_PROCESS]: async () => {
        const err = new Error("handler self-abort");
        err.name = "AbortError";
        throw err;
      },
    } as never,
    { once: false, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => {
        if (claimed) return null;
        claimed = true;
        return { id: "self-abort", type: "ARTICLE_PROCESS", attempts: 0, payload: {} } as never;
      },
      startJob: async () => ({ status: "RUNNING" }) as never,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async () => null,
    },
  );

  assert.equal(stats.stoppedBySignal, true, "self-abort treated as stop signal");
});

test("outer catch: non-abort crash in dependency propagates after logging", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const errors: string[] = [];

  await assert.rejects(
    () => runWorkerLoop(
      "worker-crash",
      {} as never,
      { once: true, heartbeatIntervalMs: 50000 },
      { info: () => {}, warn: () => {}, error: (msg: string) => { errors.push(msg); } },
      {
        claimNextJob: async () => { throw new Error("DB exploded"); },
        startJob: async () => null,
        heartbeatJob: async () => true,
        completeJob: async () => null,
        failJob: async () => null,
      },
    ),
    { message: "DB exploded" },
  );

  assert.ok(errors.some((e) => e.includes("job worker loop crashed")));
});

test("outer catch: abort error in sleep sets stoppedBySignal", async () => {
  const { runWorkerLoop } = await import("@/lib/worker");
  const { JobType } = await import("@/lib/jobs");

  const stats = await runWorkerLoop(
    "worker-sleep-abort",
    {
      [JobType.ARTICLE_PROCESS]: async () => {},
    } as never,
    { once: false, heartbeatIntervalMs: 50000 },
    silentLogger,
    {
      claimNextJob: async () => null, // no jobs
      startJob: async () => null,
      heartbeatJob: async () => true,
      completeJob: async () => null,
      failJob: async () => null,
      sleep: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    },
  );

  assert.equal(stats.stoppedBySignal, true);
});
