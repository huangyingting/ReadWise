/**
 * Unit tests for the LEVEL_ADAPT worker handler (#1303).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLevelAdaptHandler } from "@/lib/worker/registry";
import { JobError } from "@/lib/jobs";

const logs: unknown[][] = [];
const logger = {
  info: (...args: unknown[]) => logs.push(args),
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never;

test("LEVEL_ADAPT validates its payload and maps outcomes", async () => {
  const calls: unknown[][] = [];
  let outcome: unknown = { status: "generated", level: { levelKey: "B1" } };
  const handler = makeLevelAdaptHandler(async (...args) => {
    calls.push(args);
    return outcome as never;
  });

  await handler({ id: "j1", payload: { articleId: "a1", levelKey: "B1", actorId: "admin", replace: true } } as never, { logger });
  assert.deepEqual(calls[0], ["a1", "B1", { actorId: "admin", replace: true }]);
  assert.deepEqual(logs.at(-1), [
    "level adapt job processed",
    { jobId: "j1", articleId: "a1", levelKey: "B1", status: "generated", reason: null },
  ]);

  outcome = { status: "skipped", reason: "provider_unconfigured" };
  await handler({ id: "j2", payload: { articleId: "a1", levelKey: "A2" } } as never, { logger });
  assert.deepEqual(calls[1], ["a1", "A2", { actorId: null, replace: false }]);
  assert.equal((logs.at(-1)?.[1] as { reason: string }).reason, "provider_unconfigured");

  for (const payload of [null, { articleId: "a1" }, { articleId: "a1", levelKey: "original" }, { levelKey: "B1" }]) {
    await assert.rejects(handler({ id: "bad", payload } as never, { logger }), (err: unknown) => {
      assert.ok(err instanceof JobError);
      assert.equal(err.kind, "validation");
      return true;
    });
  }

  outcome = { status: "failed", reason: "provider_error" };
  await assert.rejects(handler({ id: "j3", payload: { articleId: "a1", levelKey: "B1" } } as never, { logger }), (err: unknown) => {
    assert.ok(err instanceof JobError);
    assert.equal(err.kind, "provider");
    assert.equal(err.reason, "provider_error");
    return true;
  });
  outcome = { status: "failed", reason: "article_not_found" };
  await assert.rejects(handler({ id: "j4", payload: { articleId: "gone", levelKey: "B1" } } as never, { logger }), (err: unknown) => {
    assert.ok(err instanceof JobError);
    assert.equal(err.kind, "missing");
    return true;
  });
});
