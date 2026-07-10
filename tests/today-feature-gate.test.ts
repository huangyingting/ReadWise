/**
 * today-feature-gate — canonical Today-domain gate tests (#962).
 *
 * Proves that `TODAY_THROWING_GATE` and `enforceTodayGate()` from
 * `src/lib/engagement/today-session/feature-gate.ts` correctly throw
 * `ApiError(404)` when disabled and return `undefined` when enabled, without
 * touching source text.  The test sets and clears the env var directly so it
 * exercises the real `isFeatureEnabled` path.
 */
process.env.LOG_LEVEL = "error";

import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";

const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

beforeEach(() => {
  process.env[FLAG] = "true";
});

afterEach(() => {
  delete process.env[FLAG];
});

describe("TODAY_THROWING_GATE — gate object shape", () => {
  test("targets the todaySession feature key", async () => {
    const { TODAY_THROWING_GATE } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.equal(TODAY_THROWING_GATE.feature, "todaySession");
    assert.equal(typeof TODAY_THROWING_GATE.whenDisabled, "function");
  });

  test("whenDisabled throws ApiError(404, 'Not found')", async () => {
    const { TODAY_THROWING_GATE } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.throws(
      () => TODAY_THROWING_GATE.whenDisabled(null),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must be an Error");
        assert.equal((err as Error & { name: string }).name, "ApiError");
        assert.equal((err as unknown as { status: number }).status, 404);
        assert.equal(err.message, "Not found");
        return true;
      },
    );
  });
});

describe("enforceTodayGate() — runtime behavior", () => {
  test("returns undefined when todaySession is enabled", async () => {
    process.env[FLAG] = "true";
    const { enforceTodayGate } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    const result = enforceTodayGate();
    assert.equal(result, undefined);
  });

  test("throws ApiError(404) when todaySession is disabled via env var", async () => {
    process.env[FLAG] = "false";
    const { enforceTodayGate } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.throws(
      () => enforceTodayGate(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error & { name: string }).name, "ApiError");
        assert.equal((err as unknown as { status: number }).status, 404);
        assert.equal(err.message, "Not found");
        return true;
      },
    );
  });

  test("throws when disabled via '0'", async () => {
    process.env[FLAG] = "0";
    const { enforceTodayGate } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.throws(
      () => enforceTodayGate(),
      (err: unknown) => {
        assert.equal((err as { status: number }).status, 404);
        return true;
      },
    );
  });

  test("throws when disabled via 'off'", async () => {
    process.env[FLAG] = "off";
    const { enforceTodayGate } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.throws(
      () => enforceTodayGate(),
      (err: unknown) => {
        assert.equal((err as { status: number }).status, 404);
        return true;
      },
    );
  });

  test("returns undefined when flag absent (default-enabled)", async () => {
    delete process.env[FLAG];
    const { enforceTodayGate } = await import(
      "@/lib/engagement/today-session/feature-gate"
    );
    assert.equal(enforceTodayGate(), undefined);
  });
});
