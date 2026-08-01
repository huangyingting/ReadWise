process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const upserts: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          upsert: async (args: Record<string, unknown>) => {
            upserts.push(args);
            return {};
          },
        },
      },
    },
  });
});

beforeEach(() => {
  upserts.length = 0;
});

test("canary registry sync seeds every source disabled without overwriting runtime state", async () => {
  const { syncCanaryDiscoverySources } = await import(
    "@/lib/scraper/incremental/canary-registry"
  );

  const result = await syncCanaryDiscoverySources();

  assert.deepEqual(result, { synced: 3 });
  assert.equal(upserts.length, 3);
  for (const args of upserts) {
    const create = args.create as Record<string, unknown>;
    const update = args.update as Record<string, unknown>;
    assert.equal(create.lifecycleMode, "DISABLED");
    assert.equal("lifecycleMode" in update, false);
    assert.equal("nextRunAt" in update, false);
    assert.equal("leaseOwner" in update, false);
    assert.equal("checkpointCursor" in update, false);
    assert.equal("watermarkKey" in update, false);
    assert.equal("autoPublishTrusted" in update, false);
  }
});
