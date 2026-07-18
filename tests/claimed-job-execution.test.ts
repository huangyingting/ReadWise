import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { Job } from "@/lib/jobs";

process.env.LOG_LEVEL = "error";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

test("claimed-job execution aborts the handler and skips terminal CAS after heartbeat ownership loss", async () => {
  const { createClaimedJobExecutor } = await import("@/lib/worker/claimed-execution");
  let handlerAborted = false;
  let heartbeatCount = 0;
  let completeCount = 0;
  let failCount = 0;

  const execute = createClaimedJobExecutor(
    {
      workerId: "worker-hb",
      handlers: {
        ARTICLE_PROCESS: async (_job, { signal }) => {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("handler was not aborted")), 250);
            signal?.addEventListener("abort", () => {
              clearTimeout(timeout);
              handlerAborted = true;
              resolve();
            }, { once: true });
          });
        },
      },
      heartbeatIntervalMs: 10,
      logger: silentLogger,
    },
    {
      startJob: async () => ({ status: "RUNNING" }) as Job,
      heartbeatJob: async () => {
        heartbeatCount++;
        return false;
      },
      completeJob: async () => {
        completeCount++;
        return null;
      },
      failJob: async () => {
        failCount++;
        return null;
      },
    },
  );

  const result = await execute({
    id: "job-hb",
    type: "ARTICLE_PROCESS",
    status: "CLAIMED",
    attempts: 0,
    payload: {},
  } as Job);

  assert.equal(result.outcome, "aborted");
  assert.equal(heartbeatCount, 1);
  assert.equal(handlerAborted, true);
  assert.equal(completeCount, 0);
  assert.equal(failCount, 0);
});