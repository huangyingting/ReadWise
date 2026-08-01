/** Filter and pagination coverage for the sanitized backfill-run listing. */
process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, mock, test } from "node:test";

import { BackfillRunStatus } from "@prisma/client";

let findManyArgs: Record<string, unknown> | null = null;

const NOW = new Date("2026-07-31T16:00:00.000Z");
const row = {
  id: "backfill-query-run",
  providerKey: "provider-query",
  discoverySourceId: null,
  actorId: "operator-query",
  reason: "approved historical recovery",
  requestedWindowStart: NOW,
  requestedWindowEnd: NOW,
  requestedMaxItems: 100,
  windowStart: NOW,
  windowEnd: NOW,
  maxItems: 100,
  status: BackfillRunStatus.RUNNING,
  checkpointCursor: null,
  matchedCount: 2,
  reactivatedCount: 1,
  skippedCount: 1,
  failedCount: 0,
  warnings: ["window-clamped", 42],
  startedAt: NOW,
  completedAt: null,
  cancelledAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        backfillRun: {
          count: async () => 1,
          findMany: async (args: Record<string, unknown>) => {
            findManyArgs = args;
            return [row];
          },
        },
      },
    },
  });
});

test("listBackfillRuns applies filters, clamps pagination, and sanitizes warnings", async () => {
  const { listBackfillRuns } = await import("@/lib/scraper/incremental/backfill-query");

  const page = await listBackfillRuns({
    status: BackfillRunStatus.RUNNING,
    providerKey: "provider-query",
    offset: -5,
    limit: 500,
  });

  assert.equal(page.total, 1);
  assert.equal(page.offset, 0);
  assert.equal(page.limit, 200);
  assert.deepEqual(page.runs[0]?.warnings, ["window-clamped"]);
  assert.deepEqual(findManyArgs?.where, {
    status: BackfillRunStatus.RUNNING,
    providerKey: "provider-query",
  });
  assert.equal(findManyArgs?.skip, 0);
  assert.equal(findManyArgs?.take, 200);
});
