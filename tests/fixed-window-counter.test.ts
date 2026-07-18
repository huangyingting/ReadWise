process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let countByWindow = new Map<string, number>();
let databaseThrows = false;
let upsertCalls = 0;
let lastCreate: Record<string, unknown> | null = null;
let sweepThrows = false;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        rateLimitCounter: {
          upsert: async (args: {
            where: { bucketKey_windowStart: { bucketKey: string; windowStart: Date } };
            create: Record<string, unknown>;
          }) => {
            upsertCalls += 1;
            if (databaseThrows) throw new Error("database unavailable");
            lastCreate = args.create;
            const window = args.where.bucketKey_windowStart;
            const key = `${window.bucketKey}:${window.windowStart.getTime()}`;
            const count = (countByWindow.get(key) ?? 0) + 1;
            countByWindow.set(key, count);
            return { count };
          },
          deleteMany: async () => {
            if (sweepThrows) throw new Error("sweep unavailable");
            return { count: 0 };
          },
        },
      },
    },
  });
});

beforeEach(async () => {
  countByWindow = new Map();
  databaseThrows = false;
  upsertCalls = 0;
  lastCreate = null;
  sweepThrows = false;
  process.env.RATE_LIMIT_STORE = "memory";
  const { resetFixedWindowCounters } = await import("@/lib/security/fixed-window-counter");
  resetFixedWindowCounters();
});

test("database adapter owns alignment, atomic increments, and expiry", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  const { consumeFixedWindow } = await import("@/lib/security/fixed-window-counter");
  const input = {
    key: "db:counter",
    windowMs: 500,
    nowMs: 1_249,
    fallbackWindowAnchor: "epoch" as const,
  };

  assert.equal(await consumeFixedWindow(input), 1);
  assert.equal(await consumeFixedWindow(input), 2);
  assert.equal(upsertCalls, 2);
  assert.equal((lastCreate?.windowStart as Date).getTime(), 1_000);
  assert.equal((lastCreate?.expiresAt as Date).getTime(), 2_000);
});

test("memory adapter preserves first-hit and epoch fallback windows", async () => {
  const { consumeFixedWindow } = await import("@/lib/security/fixed-window-counter");

  assert.equal(await consumeFixedWindow({
    key: "first-hit",
    windowMs: 1_000,
    nowMs: 999,
    fallbackWindowAnchor: "first-hit",
  }), 1);
  assert.equal(await consumeFixedWindow({
    key: "first-hit",
    windowMs: 1_000,
    nowMs: 1_001,
    fallbackWindowAnchor: "first-hit",
  }), 2);

  assert.equal(await consumeFixedWindow({
    key: "epoch",
    windowMs: 1_000,
    nowMs: 999,
    fallbackWindowAnchor: "epoch",
  }), 1);
  assert.equal(await consumeFixedWindow({
    key: "epoch",
    windowMs: 1_000,
    nowMs: 1_001,
    fallbackWindowAnchor: "epoch",
  }), 1);
});

test("store failures fall back once and auto mode opens the circuit", async () => {
  process.env.RATE_LIMIT_STORE = "auto";
  databaseThrows = true;
  const { consumeFixedWindow } = await import("@/lib/security/fixed-window-counter");
  const nowMs = Date.now();

  assert.equal(await consumeFixedWindow({
    key: "fallback",
    windowMs: 1_000,
    nowMs,
    fallbackWindowAnchor: "first-hit",
  }), 1);
  databaseThrows = false;
  assert.equal(await consumeFixedWindow({
    key: "fallback",
    windowMs: 1_000,
    nowMs: nowMs + 1,
    fallbackWindowAnchor: "first-hit",
  }), 2);
  assert.equal(upsertCalls, 1);
});

test("local observation is synchronous and database mirroring is best-effort", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  databaseThrows = true;
  const { observeFixedWindow } = await import("@/lib/security/fixed-window-counter");
  const nowMs = Date.now();

  assert.equal(observeFixedWindow({ key: "spike", windowMs: 1_000, nowMs }), 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(observeFixedWindow({ key: "spike", windowMs: 1_000, nowMs: nowMs + 1 }), 2);
  assert.equal(upsertCalls, 1);
});

test("opportunistic sweep failures never surface from consumption", async (t) => {
  process.env.RATE_LIMIT_STORE = "database";
  sweepThrows = true;
  t.mock.method(Math, "random", () => 0);
  const { consumeFixedWindow } = await import("@/lib/security/fixed-window-counter");

  await assert.doesNotReject(() => consumeFixedWindow({
    key: "sweep",
    windowMs: 500,
    nowMs: 1_000,
    fallbackWindowAnchor: "epoch",
  }));
  await Promise.resolve();
});