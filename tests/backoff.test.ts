/**
 * Tests for the jittered exponential backoff helper (REF-085).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { jitteredExponentialBackoff } from "@/lib/backoff";

describe("jitteredExponentialBackoff", () => {
  test("returns 0 when baseMs is 0", () => {
    assert.strictEqual(
      jitteredExponentialBackoff({ attempt: 1, baseMs: 0, maxMs: 5000 }),
      0,
    );
  });

  test("returns 0 when maxMs is 0", () => {
    assert.strictEqual(
      jitteredExponentialBackoff({ attempt: 1, baseMs: 1000, maxMs: 0 }),
      0,
    );
  });

  test("returns 0 when baseMs is negative", () => {
    assert.strictEqual(
      jitteredExponentialBackoff({ attempt: 1, baseMs: -100, maxMs: 5000 }),
      0,
    );
  });

  test("result is >= base delay on attempt 1 (no jitter path with random=0)", () => {
    const delay = jitteredExponentialBackoff({
      attempt: 1,
      baseMs: 1000,
      maxMs: 30000,
      random: () => 0,
    });
    assert.strictEqual(delay, 1000);
  });

  test("doubles on each attempt (no jitter path)", () => {
    const opts = { baseMs: 500, maxMs: 10000, random: () => 0 };
    const d1 = jitteredExponentialBackoff({ ...opts, attempt: 1 });
    const d2 = jitteredExponentialBackoff({ ...opts, attempt: 2 });
    const d3 = jitteredExponentialBackoff({ ...opts, attempt: 3 });
    assert.strictEqual(d2, d1 * 2);
    assert.strictEqual(d3, d1 * 4);
  });

  test("is always <= maxMs", () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = jitteredExponentialBackoff({
        attempt,
        baseMs: 1000,
        maxMs: 8000,
        random: Math.random,
      });
      assert.ok(delay <= 8000, `attempt ${attempt}: delay ${delay} exceeds maxMs 8000`);
    }
  });

  test("is always >= 0", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = jitteredExponentialBackoff({
        attempt,
        baseMs: 1000,
        maxMs: 8000,
        random: Math.random,
      });
      assert.ok(delay >= 0, `delay should be non-negative, got ${delay}`);
    }
  });

  test("caps at maxMs for very high attempts", () => {
    const delay = jitteredExponentialBackoff({
      attempt: 100,
      baseMs: 1000,
      maxMs: 5000,
      random: () => 0,
    });
    assert.strictEqual(delay, 5000);
  });

  test("uses provided random source (injectable for determinism)", () => {
    const deterministicRandom = () => 0.5;
    const delay1 = jitteredExponentialBackoff({
      attempt: 2,
      baseMs: 1000,
      maxMs: 30000,
      random: deterministicRandom,
    });
    const delay2 = jitteredExponentialBackoff({
      attempt: 2,
      baseMs: 1000,
      maxMs: 30000,
      random: deterministicRandom,
    });
    assert.strictEqual(delay1, delay2);
  });
});
