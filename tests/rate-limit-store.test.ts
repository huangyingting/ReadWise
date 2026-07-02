import { test } from "node:test";
import assert from "node:assert/strict";
import type { RateLimitStoreClient } from "@/lib/security/rate-limit/store";

test("incrementSharedCounter opportunistically sweeps expired rows without surfacing sweep failures", async (t) => {
  t.mock.method(Math, "random", () => 0);
  let deleteManyArgs: unknown = null;
  const client = {
    rateLimitCounter: {
      upsert: async () => ({ count: 4 }),
      deleteMany: async (args: unknown) => {
        deleteManyArgs = args;
        throw new Error("sweep failed");
      },
    },
  } satisfies RateLimitStoreClient;
  const { incrementSharedCounter } = await import("@/lib/security/rate-limit/store");

  const count = await incrementSharedCounter("bucket:rate-limit-store", 1_000, 500, client);
  await Promise.resolve();

  assert.equal(count, 4);
  assert.ok(deleteManyArgs);
  assert.ok(
    ((deleteManyArgs as { where: { expiresAt: { lt: Date } } }).where.expiresAt.lt) instanceof Date,
  );
});
