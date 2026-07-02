process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

let loadedSession: { user: { id: string; role?: string | null } } | null;
let onboarded: boolean;
let capabilityAllowed: boolean;
let pushConfigured: boolean;
let pushSubs: Array<{ id: string; endpoint: string; p256dh: string; auth: string; failureCount?: number }>;
let pushSent: Array<{ endpoint: string; payload: string }>;
let pushFailures: Record<string, { statusCode?: number; message?: string }>;
let healthCalls: Record<string, string[]>;
let speechRows: Array<{ id: string; articleId: string; words: unknown }>;
let speechUpdates: Array<{ where: { id: string }; data: { words: unknown } }>;
let failSpeechUpdateIds: Set<string>;
let workerMetrics: unknown[];
let capturedWorkerErrors: unknown[];
let loggerErrors: unknown[];

class MockJobError extends Error {
  readonly kind?: string;
  constructor(message: string, opts?: { kind?: string }) {
    super(message);
    this.name = "JobError";
    this.kind = opts?.kind;
  }
}

const MockJobType = {
  ARTICLE_INGEST: "ARTICLE_INGEST",
  ARTICLE_PROCESS: "ARTICLE_PROCESS",
  AI_REBUILD: "AI_REBUILD",
  TTS_GENERATE: "TTS_GENERATE",
  PUSH_REMINDER: "PUSH_REMINDER",
} as const;

before(() => {
  mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw new Error(`redirect:${url}`);
      },
    },
  });
  mock.module("@/lib/auth-core", {
    namedExports: {
      loadSession: async () => loadedSession,
      sessionHasCapability: () => capabilityAllowed,
    },
  });
  mock.module("@/lib/profile", {
    namedExports: {
      isUserOnboarded: async () => onboarded,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => logger,
      getRequestContext: () => ({}),
      getRequestId: () => null,
      runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
      setRequestContext: () => {},
    },
  });
  mock.module("@/lib/processing/processor", {
    namedExports: {
      processArticle: async () => null,
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordWorkerJob: (input: unknown) => {
        workerMetrics.push(input);
      },
    },
  });
  mock.module("@/lib/observability/tracing", {
    namedExports: {
      withSpan: async (_name: string, _attrs: unknown, fn: () => unknown) => fn(),
    },
  });
  mock.module("@/lib/observability/errors", {
    namedExports: {
      captureError: (err: unknown, ctx: unknown) => {
        capturedWorkerErrors.push({ err, ctx });
      },
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: {
          findMany: async (args: { take?: number }) =>
            args.take ? speechRows.slice(0, args.take) : speechRows,
          update: async (args: { where: { id: string }; data: { words: unknown } }) => {
            if (failSpeechUpdateIds.has(args.where.id)) throw new Error("update failed");
            speechUpdates.push(args);
            return args;
          },
        },
        pushSubscription: {
          findMany: async () => pushSubs,
        },
      },
    },
  });
  mock.module("@/lib/push/provider", {
    namedExports: {
      ensurePushInit: () => pushConfigured,
      sendWebPushNotification: async (
        sub: { endpoint: string },
        payload: string,
      ) => {
        const failure = pushFailures[sub.endpoint];
        if (failure) {
          const err = new Error(failure.message ?? "push failed") as Error & { statusCode?: number };
          err.statusCode = failure.statusCode;
          throw err;
        }
        pushSent.push({ endpoint: sub.endpoint, payload });
      },
    },
  });
  mock.module("@/lib/push/subscription-health", {
    namedExports: {
      MAX_CONSECUTIVE_FAILURES: 3,
      pruneDeadSubscriptions: async (ids: string[]) => {
        healthCalls.dead = ids;
      },
      recordDeliverySuccess: async (ids: string[]) => {
        healthCalls.success = ids;
      },
      recordTransientFailure: async (ids: string[]) => {
        healthCalls.fail = ids;
      },
    },
  });
  mock.module("@/lib/jobs", {
    namedExports: {
      claimNextJob: async () => null,
      completeJob: async () => null,
      failJob: async () => null,
      JobError: MockJobError,
      JobStatus: { DEAD_LETTER: "DEAD_LETTER", FAILED: "FAILED" },
      JobType: MockJobType,
      startJob: async () => null,
    },
  });
});

beforeEach(() => {
  loadedSession = { user: { id: "user-1", role: "Reader" } };
  onboarded = true;
  capabilityAllowed = true;
  pushConfigured = true;
  pushSubs = [{ id: "sub-1", endpoint: "https://push.test/sub-1", p256dh: "p", auth: "a" }];
  pushSent = [];
  pushFailures = {};
  healthCalls = { dead: [], success: [], fail: [] };
  speechRows = [];
  speechUpdates = [];
  failSpeechUpdateIds = new Set();
  workerMetrics = [];
  capturedWorkerErrors = [];
  loggerErrors = [];
});

test("session guards redirect unauthenticated, not-onboarded, and unauthorized users", async () => {
  const sessionModule = await import("@/lib/session");

  assert.equal((await sessionModule.requireSession("/reader")).user.id, "user-1");
  loadedSession = null;
  await assert.rejects(() => sessionModule.requireSession("/reader?id=1"), /redirect:\/signin\?callbackUrl=%2Freader%3Fid%3D1/);

  loadedSession = { user: { id: "user-1", role: "Reader" } };
  onboarded = false;
  await assert.rejects(() => sessionModule.requireOnboardedSession("/reader"), /redirect:\/onboarding/);
  onboarded = true;
  assert.equal((await sessionModule.requireOnboardedSession("/reader")).user.id, "user-1");

  capabilityAllowed = false;
  await assert.rejects(() => sessionModule.requireCapability("admin.access" as never, "/admin"), /redirect:\/forbidden/);
  capabilityAllowed = true;
  assert.equal((await sessionModule.requireCapability("admin.access" as never, "/admin")).user.id, "user-1");
});

test("speech timing migration skips V2 rows and counts malformed or failed legacy updates", async () => {
  const { migrateArticleSpeechTimingsToV2 } = await import("@/lib/speech/timing-migration");

  speechRows = [
    { id: "current", articleId: "a-current", words: { version: 2, words: [] } },
    {
      id: "valid",
      articleId: "a-valid",
      words: [{ word: "hello", offset: 10, duration: 20, textOffset: 0, wordLength: 5 }],
    },
    { id: "bad", articleId: "a-bad", words: [{ word: "", offset: 0, duration: 1 }] },
    {
      id: "update-fails",
      articleId: "a-fails",
      words: [{ word: "bye", offset: 0, duration: 1 }],
    },
  ];
  failSpeechUpdateIds.add("update-fails");

  const result = await migrateArticleSpeechTimingsToV2({ limit: 4, provider: "azure" });
  assert.deepEqual(result, { scanned: 4, migrated: 1, skippedCurrent: 1, failed: 2 });
  assert.equal(speechUpdates.length, 1);
  assert.equal((speechUpdates[0].data.words as { version: number }).version, 2);
});

test("push delivery skips unconfigured providers and sends to loaded subscriptions", async () => {
  const { sendPushToUser, sendToSubs } = await import("@/lib/push/delivery");

  pushConfigured = false;
  assert.equal(await sendToSubs(pushSubs, "{}"), 0);
  assert.equal(await sendPushToUser("user-1", { title: "Hi", body: "There" }), 0);
  assert.equal(pushSent.length, 0);

  pushConfigured = true;
  assert.equal(await sendToSubs([], "{}"), 0);
  assert.equal(await sendPushToUser("user-1", { title: "Hi", body: "There", url: "/today" }), 1);
  assert.equal(pushSent[0].endpoint, "https://push.test/sub-1");
  assert.deepEqual(healthCalls.success, ["sub-1"]);

  pushFailures = {
    "https://push.test/dead": { statusCode: 410 },
    "https://push.test/threshold": { statusCode: 503 },
    "https://push.test/transient": { message: "temporary" },
  };
  const delivered = await sendToSubs(
    [
      { id: "success", endpoint: "https://push.test/success", p256dh: "p", auth: "a" },
      { id: "dead", endpoint: "https://push.test/dead", p256dh: "p", auth: "a" },
      { id: "threshold", endpoint: "https://push.test/threshold", p256dh: "p", auth: "a", failureCount: 2 },
      { id: "transient", endpoint: "https://push.test/transient", p256dh: "p", auth: "a", failureCount: 1 },
    ],
    "{}",
  );
  assert.equal(delivered, 1);
  assert.deepEqual([...healthCalls.dead].sort(), ["dead", "threshold"]);
  assert.deepEqual(healthCalls.fail, ["transient"]);
  assert.deepEqual(healthCalls.success, ["success"]);
});

test("worker registry handlers validate payloads, processor results, and no-op push jobs", async () => {
  const {
    JobHandlerRegistry,
    createDefaultRegistry,
    makeArticleHandler,
  } = await import("@/lib/worker/registry");
  const { JobType } = await import("@/lib/jobs");
  const logs: unknown[] = [];
  const workerLogger = { ...logger, info: (...args: unknown[]) => logs.push(args) };

  const customHandler = async () => {};
  const registry = new JobHandlerRegistry({ [JobType.ARTICLE_PROCESS]: customHandler } as never);
  assert.equal(registry.get(JobType.ARTICLE_PROCESS), customHandler);
  registry.register(JobType.TTS_GENERATE, customHandler);
  assert.equal(registry.toRecord()[JobType.TTS_GENERATE], customHandler);

  let processOptions: unknown;
  const handler = makeArticleHandler(async (_articleId, opts) => {
    processOptions = opts;
    return { articleId: "a1", title: "A1", ok: true, published: true, steps: [] };
  });
  await handler(
    { id: "job-1", payload: { articleId: "a1", tts: true } } as never,
    { logger: workerLogger, process: { tts: false, translateLangs: ["es"] } },
  );
  assert.deepEqual(processOptions, { tts: true, translateLangs: ["es"] });
  assert.equal(logs.length, 1);

  await assert.rejects(
    () => handler({ id: "job-2", payload: {} } as never, { logger: workerLogger }),
    /missing articleId/,
  );
  const missingHandler = makeArticleHandler(async () => null);
  await assert.rejects(
    () => missingHandler({ id: "job-3", payload: { articleId: "missing" } } as never, { logger: workerLogger }),
    /not found/,
  );
  const failedHandler = makeArticleHandler(async () => ({
    articleId: "a1",
    title: "A1",
    ok: false,
    published: false,
    steps: [{ step: "tags", status: "failed" }],
  }));
  await assert.rejects(
    () => failedHandler({ id: "job-4", payload: { articleId: "a1" } } as never, { logger: workerLogger }),
    /processing failed \(tags: unknown\)/,
  );

  const defaults = createDefaultRegistry(async () => ({ articleId: "a1", title: "A1", ok: true, published: false, steps: [] }));
  await defaults.get(JobType.PUSH_REMINDER)?.({ id: "push-job" } as never, { logger: workerLogger });
  assert.ok(logs.some((entry) => JSON.stringify(entry).includes("push-job")));
});

test("worker loop handles aborts, missing handlers, retry/dead-letter accounting, and crashes", async () => {
  const { runWorkerLoop } = await import("@/lib/worker/loop");
  const { createConsoleLogger, generateWorkerId, runJobWorker } = await import("@/lib/worker/index");
  const { JobType, JobStatus } = await import("@/lib/jobs");
  const workerLogger = {
    ...logger,
    error: (...args: unknown[]) => loggerErrors.push(args),
  };

  assert.match(generateWorkerId(), /^worker-\d+-[a-z0-9]+$/);
  assert.equal(createConsoleLogger(), logger);

  const preAborted = new AbortController();
  preAborted.abort();
  let stats = await runWorkerLoop("worker-a", {}, { signal: preAborted.signal }, workerLogger);
  assert.equal(stats.stoppedBySignal, true);
  assert.equal(stats.polls, 0);

  const abortAfterSleep = new AbortController();
  stats = await runWorkerLoop(
    "worker-a",
    {},
    { signal: abortAfterSleep.signal, pollIntervalMs: 1 },
    workerLogger,
    {
      claimNextJob: async () => null,
      sleep: async () => {
        abortAfterSleep.abort();
      },
    },
  );
  assert.equal(stats.polls, 1);
  assert.equal(stats.stoppedBySignal, true);

  let missingHandlerClaimed = false;
  stats = await runWorkerLoop(
    "worker-a",
    {},
    { once: true },
    workerLogger,
    {
      claimNextJob: async () => {
        if (missingHandlerClaimed) return null;
        missingHandlerClaimed = true;
        return {
          id: "job-missing-handler",
          type: JobType.ARTICLE_PROCESS,
          attempts: 0,
        } as never;
      },
      startJob: async () => null,
      failJob: async () => ({ status: JobStatus.FAILED }) as never,
    },
  );
  assert.equal(stats.failed, 1);
  assert.equal(stats.retried, 1);
  assert.equal(capturedWorkerErrors.length, 1);

  let successClaimed = false;
  stats = await runWorkerLoop(
    "worker-a",
    {
      [JobType.ARTICLE_PROCESS]: async () => null,
    } as never,
    { once: true },
    workerLogger,
    {
      claimNextJob: async () => {
        if (successClaimed) return null;
        successClaimed = true;
        return {
          id: "job-success",
          type: JobType.ARTICLE_PROCESS,
          attempts: 2,
        } as never;
      },
      startJob: async () => null,
      completeJob: async () => null,
    },
  );
  assert.equal(stats.completed, 1);
  assert.ok(workerMetrics.some((entry) => (entry as { outcome?: string }).outcome === "success"));

  let deadLetterClaimed = false;
  stats = await runWorkerLoop(
    "worker-a",
    {
      [JobType.ARTICLE_PROCESS]: async () => {
        throw new Error("final failure");
      },
    } as never,
    { once: true },
    workerLogger,
    {
      claimNextJob: async () => {
        if (deadLetterClaimed) return null;
        deadLetterClaimed = true;
        return {
          id: "job-dead-letter",
          type: JobType.ARTICLE_PROCESS,
          attempts: 4,
        } as never;
      },
      startJob: async () => null,
      failJob: async () => ({ status: JobStatus.DEAD_LETTER }) as never,
    },
  );
  assert.equal(stats.deadLettered, 1);

  stats = await runWorkerLoop(
    "worker-a",
    {
      [JobType.ARTICLE_PROCESS]: async () => {
        const err = new Error("stop");
        err.name = "AbortError";
        throw err;
      },
    } as never,
    { once: true },
    workerLogger,
    {
      claimNextJob: async () => ({
        id: "job-abort",
        type: JobType.ARTICLE_PROCESS,
        attempts: 1,
      }) as never,
      startJob: async () => null,
    },
  );
  assert.equal(stats.stoppedBySignal, true);
  assert.ok(workerMetrics.some((entry) => (entry as { outcome?: string }).outcome === "aborted"));

  stats = await runWorkerLoop("worker-a", {}, { once: true }, workerLogger, {
    claimNextJob: async () => {
      const err = new Error("abort claim");
      err.name = "AbortError";
      throw err;
    },
  });
  assert.equal(stats.stoppedBySignal, true);

  await assert.rejects(
    () =>
      runWorkerLoop("worker-a", {}, { once: true }, workerLogger, {
        claimNextJob: async () => {
          throw new Error("database down");
        },
      }),
    /database down/,
  );
  assert.ok(JSON.stringify(loggerErrors).includes("database down"));

  const startedStopped: unknown[] = [];
  const workerClaims: unknown[] = [];
  const publicStats = await runJobWorker({
    workerId: "worker-public",
    logger: {
      ...workerLogger,
      info: (...args: unknown[]) => startedStopped.push(args),
    },
    pollIntervalMs: 2,
    lockTtlMs: 3,
    types: [JobType.ARTICLE_PROCESS],
    once: true,
    process: { tts: true, translateLangs: ["es"] },
    deps: {
      processArticle: async () => ({
        articleId: "article-1",
        title: "Article 1",
        published: false,
        steps: [],
        ok: true,
      }),
      claimNextJob: async (...args: unknown[]) => {
        workerClaims.push(args);
        return null;
      },
      startJob: async () => null,
      completeJob: async () => null,
      failJob: async () => null,
      sleep: async () => {},
    },
  });
  assert.deepEqual(publicStats, {
    polls: 1,
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    stoppedBySignal: false,
  });
  assert.ok(JSON.stringify(startedStopped).includes("job worker started"));
  assert.ok(JSON.stringify(startedStopped).includes("job worker stopped"));
  assert.ok(JSON.stringify(workerClaims).includes("worker-public"));
});
