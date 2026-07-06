import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { importPrismaModule, restorePrismaEnvironment } from "./helpers/prisma-module";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";

afterEach(() => {
  mock.reset();
  resetMetrics();
  restorePrismaEnvironment();
});

test("prisma initializes the default sqlite client and caches it outside production", async () => {
  const result = await importPrismaModule({ nodeEnv: "test", postgres: false });

  assert.deepEqual(result.sqliteAdapters, [
    { url: `file:${path.join(process.cwd(), "prisma/dev.db").replace(/\\/g, "/")}` },
  ]);
  assert.deepEqual(result.pgAdapters, []);
  assert.deepEqual(result.prismaClientCalls[0]?.log, ["error"]);
  assert.equal(
    (result.prismaExtensions[0] as { name?: string } | undefined)?.name,
    "readwise-prisma-query-timing",
  );
  assert.equal((globalThis as { prisma?: unknown }).prisma, result.prisma);
});

test("prisma instruments raw query helpers with content-free db metrics", async () => {
  resetMetrics();
  const result = await importPrismaModule({ nodeEnv: "test", postgres: false });
  const client = result.prisma as { $queryRaw: (...args: unknown[]) => Promise<unknown> };

  await client.$queryRaw(["SELECT 1"]);

  const point = getMetricsSnapshot().counters.find(
    (candidate) =>
      candidate.name === "readwise_db_queries_total" &&
      candidate.labels.provider === "sqlite" &&
      candidate.labels.model === "client" &&
      candidate.labels.operation === "queryraw" &&
      candidate.labels.outcome === "success",
  );
  assert.equal(point?.value, 1);
  assert.doesNotMatch(JSON.stringify(point), /SELECT 1/);
});

test("prisma skips query timing extension when disabled", async () => {
  const result = await importPrismaModule({
    nodeEnv: "test",
    postgres: false,
    dbQueryTimingEnabled: "false",
  });

  assert.deepEqual(result.prismaExtensions, []);
});
