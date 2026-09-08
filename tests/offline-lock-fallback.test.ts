import assert from "node:assert/strict";
import { test } from "node:test";

import { withOriginFlushLock } from "@/lib/offline/sync-runtime";

test("browser queue draining fails closed when origin-wide locking is unavailable", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  let ran = false;

  await assert.rejects(
    () =>
      withOriginFlushLock(async () => {
        ran = true;
      }),
    /origin-wide offline queue locking is unavailable/i,
  );
  assert.equal(ran, false);
});
