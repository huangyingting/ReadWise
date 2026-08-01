process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { DiscoverySourceLifecycleMode } from "@prisma/client";
import { before, beforeEach, mock, test } from "node:test";

let transactionError: Error | null = null;

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    },
  });
  mock.module("@/lib/jobs", {
    namedExports: {
      cancelPendingCandidateIngestJobsInTx: async () => 0,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          findUnique: async () => ({
            lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
            leaseOwner: null,
            definitionVersion: 1,
          }),
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return callback({
            discoverySource: {
              updateMany: async () => ({ count: 0 }),
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  transactionError = null;
});

test("active rollback maps a lost guarded update to lease-lost", async () => {
  const { rollbackActiveToShadow } = await import("@/lib/scraper/incremental/rollback-commit");

  assert.deepEqual(await rollbackActiveToShadow("source-1"), {
    committed: false,
    reason: "lease-lost",
  });
});

test("active rollback propagates unexpected transaction failures", async () => {
  const { rollbackActiveToShadow } = await import("@/lib/scraper/incremental/rollback-commit");
  transactionError = new Error("database unavailable");

  await assert.rejects(
    rollbackActiveToShadow("source-1"),
    /database unavailable/,
  );
});
