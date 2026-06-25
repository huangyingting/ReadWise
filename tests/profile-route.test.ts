process.env.LOG_LEVEL = "error"; // silence request.start/complete logs
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

const session = {
  user: { id: "user-1", role: "Reader", name: "T", email: "t@e.com" },
};

// Capture the last upsert call's arguments so tests can inspect them.
let lastUpsertArgs: { create?: Record<string, unknown>; update?: Record<string, unknown> } | null =
  null;

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session }),
      requireCapabilityApi: async () => ({ session }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: {
          findUnique: async () => null,
          upsert: async (args: {
            create?: Record<string, unknown>;
            update?: Record<string, unknown>;
          }) => {
            lastUpsertArgs = args;
            return {};
          },
        },
        levelHistory: {
          create: async () => ({}),
        },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
          return fn({
            profile: {
              upsert: async (args: {
                create?: Record<string, unknown>;
                update?: Record<string, unknown>;
              }) => {
                lastUpsertArgs = args;
                return {};
              },
            },
            levelHistory: {
              create: async () => ({}),
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  lastUpsertArgs = null;
});

function putReq(body: unknown): Request {
  return new Request("http://test/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseProfile = {
  englishLevel: "B1",
  ageRange: "25-34",
  gender: "Female",
  topics: ["tech"],
};

// ---- dailyGoal persistence ----------------------------------------------

test("PUT /api/profile persists dailyGoal when valid", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq({ ...baseProfile, dailyGoal: 5 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(lastUpsertArgs?.update?.dailyGoal, 5);
  assert.equal(lastUpsertArgs?.create?.dailyGoal, 5);
});

test("PUT /api/profile rejects dailyGoal below minimum (0)", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq({ ...baseProfile, dailyGoal: 0 }));
  assert.equal(res.status, 400);
});

test("PUT /api/profile rejects dailyGoal above maximum (11)", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq({ ...baseProfile, dailyGoal: 11 }));
  assert.equal(res.status, 400);
});

test("PUT /api/profile rejects non-integer dailyGoal", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq({ ...baseProfile, dailyGoal: 3.5 }));
  assert.equal(res.status, 400);
});

test("PUT /api/profile omits dailyGoal from upsert when not provided", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq(baseProfile));
  assert.equal(res.status, 200);
  // dailyGoal must NOT be present so we don't overwrite an existing value
  assert.equal(Object.prototype.hasOwnProperty.call(lastUpsertArgs?.update ?? {}, "dailyGoal"), false);
});

test("PUT /api/profile preserves other fields alongside dailyGoal", async () => {
  const { PUT } = (await import("@/app/api/profile/route")) as { PUT: RouteHandler };
  const res = await PUT(putReq({ ...baseProfile, dailyGoal: 3 }));
  assert.equal(res.status, 200);
  const update = lastUpsertArgs?.update ?? {};
  assert.equal(update.englishLevel, "B1");
  assert.equal(update.ageRange, "25-34");
  assert.equal(update.gender, "Female");
  assert.deepEqual(update.topics, ["tech"]);
  assert.equal(update.dailyGoal, 3);
});
