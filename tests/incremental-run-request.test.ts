import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";

type UpdateManyArgs = {
  where: {
    providerKey: { in: string[] };
    lifecycleMode: { in: unknown[] };
  };
  data: { nextRunAt: Date; updatedAt: Date };
};

const updateManyCalls: UpdateManyArgs[] = [];
let updateManyCount = 0;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          updateMany: async (args: UpdateManyArgs) => {
            updateManyCalls.push(args);
            return { count: updateManyCount };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  updateManyCalls.length = 0;
  updateManyCount = 0;
});

test("an empty provider list is a no-op", async () => {
  const { requestIncrementalRun } = await import(
    "@/lib/scraper/incremental/incremental-run-request"
  );

  assert.deepEqual(await requestIncrementalRun([]), { requested: 0 });
  assert.deepEqual(updateManyCalls, []);
});

test("only claimable sources for the requested providers are made due", async () => {
  const [{ requestIncrementalRun }, { CLAIMABLE_LIFECYCLE_MODES }] = await Promise.all([
    import("@/lib/scraper/incremental/incremental-run-request"),
    import("@/lib/scraper/incremental/schedule"),
  ]);
  const now = new Date("2026-07-31T12:00:00.000Z");
  updateManyCount = 3;

  const result = await requestIncrementalRun(["undark", "nautilus"], now);

  assert.deepEqual(result, { requested: 3 });
  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0], {
    where: {
      providerKey: { in: ["undark", "nautilus"] },
      lifecycleMode: { in: [...CLAIMABLE_LIFECYCLE_MODES] },
    },
    data: { nextRunAt: now, updatedAt: now },
  });
});
