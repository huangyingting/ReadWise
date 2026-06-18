import { test } from "node:test";
import assert from "node:assert/strict";
import { sleep, backoffDelay, runWorker } from "@/lib/worker";
import type { ArticleProcessResult } from "@/lib/processor";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test("backoffDelay grows exponentially and is capped", () => {
  const base = 100;
  const max = 1000;
  const d1 = backoffDelay(1, base, max);
  const d3 = backoffDelay(3, base, max);
  assert.ok(d1 >= base && d1 <= base * 2);
  assert.ok(d3 <= max);
  // very high attempt is clamped to max
  assert.equal(backoffDelay(20, base, max), max);
});

test("sleep resolves after the delay", async () => {
  const start = Date.now();
  await sleep(5);
  assert.ok(Date.now() - start >= 4);
});

test("sleep rejects immediately when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sleep(1000, controller.signal), /aborted/);
});

test("runWorker --once drains the queue then stops", async () => {
  const batches = [["a1", "a2"], []];
  const processed: string[] = [];
  const stats = await runWorker({
    once: true,
    logger: silentLogger,
    deps: {
      listUnprocessedArticleIds: async () => batches.shift() ?? [],
      processArticle: async (id: string): Promise<ArticleProcessResult> => {
        processed.push(id);
        return { articleId: id, title: id, ok: true, published: true, steps: [] };
      },
      sleep: async () => {},
    },
  });
  assert.deepEqual(processed.sort(), ["a1", "a2"]);
  assert.equal(stats.processed, 2);
  assert.equal(stats.published, 2);
  assert.equal(stats.failed, 0);
});

test("runWorker retries a failing article then counts it failed", async () => {
  let attempts = 0;
  const batches = [["bad"], []];
  const stats = await runWorker({
    once: true,
    maxRetries: 2,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    logger: silentLogger,
    deps: {
      listUnprocessedArticleIds: async () => batches.shift() ?? [],
      processArticle: async (id: string): Promise<ArticleProcessResult> => {
        attempts++;
        return {
          articleId: id,
          title: id,
          ok: false,
          published: false,
          steps: [{ step: "tags", status: "failed", detail: "boom" }],
        };
      },
      sleep: async () => {},
    },
  });
  // 1 initial try + 2 retries
  assert.equal(attempts, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.retried, 1);
});

test("runWorker stops promptly when the signal is aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const stats = await runWorker({
    logger: silentLogger,
    signal: controller.signal,
    deps: {
      listUnprocessedArticleIds: async () => ["never"],
      processArticle: async () => {
        throw new Error("should not run");
      },
      sleep: async () => {},
    },
  });
  assert.equal(stats.stoppedBySignal, true);
  assert.equal(stats.processed, 0);
});
