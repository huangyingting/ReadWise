process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import {
  DiscoverySourceLifecycleMode,
} from "@prisma/client";
import { before, beforeEach, mock, test } from "node:test";

const M = DiscoverySourceLifecycleMode;

type SourceRow = {
  lifecycleMode: DiscoverySourceLifecycleMode;
  leaseOwner: string | null;
  definitionVersion: number;
  watermarkAt: Date | null;
  watermarkKey: string | null;
  activatedAt: Date | null;
  canFetchAuthenticated: boolean;
  credentialRef: string | null;
  authIdentityKind: null;
};

let source: SourceRow;
let txSource: SourceRow | null;
let transactionError: Error | null;
let updateCount: number;

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          findUnique: async () => source,
        },
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          if (transactionError) throw transactionError;
          return callback({
            discoverySource: {
              findUnique: async () => txSource,
              updateMany: async () => ({ count: updateCount }),
            },
          });
        },
      },
    },
  });
});

beforeEach(() => {
  source = {
    lifecycleMode: M.DISABLED,
    leaseOwner: null,
    definitionVersion: 1,
    watermarkAt: null,
    watermarkKey: null,
    activatedAt: null,
    canFetchAuthenticated: false,
    credentialRef: null,
    authIdentityKind: null,
  };
  txSource = source;
  transactionError = null;
  updateCount = 1;
});

const base = {
  sourceId: "source-1",
  leaseOwner: null,
  definitionVersion: 1,
  now: new Date("2026-07-31T00:00:00.000Z"),
};

test("guarded lifecycle transitions map stale state to lease-lost", async () => {
  const { beginBaseline } = await import("@/lib/scraper/incremental/lifecycle-commit");
  txSource = { ...source, definitionVersion: 2 };

  assert.deepEqual(await beginBaseline(base), {
    committed: false,
    reason: "lease-lost",
  });
});

test("guarded lifecycle transitions propagate unexpected transaction failures", async () => {
  const { beginBaseline } = await import("@/lib/scraper/incremental/lifecycle-commit");
  transactionError = new Error("database unavailable");

  await assert.rejects(beginBaseline(base), /database unavailable/);
});

test("lifecycle entry points reject invalid source modes", async () => {
  const {
    activateDiscoverySource,
    beginBaseline,
    completeBaseline,
  } = await import("@/lib/scraper/incremental/lifecycle-commit");

  source.lifecycleMode = M.ACTIVE;
  assert.deepEqual(await beginBaseline(base), {
    committed: false,
    reason: "invalid-transition",
  });
  assert.deepEqual(await completeBaseline({ ...base, segments: [] }), {
    committed: false,
    reason: "invalid-transition",
  });

  source.lifecycleMode = M.DISABLED;
  assert.deepEqual(await activateDiscoverySource(base), {
    committed: false,
    reason: "invalid-transition",
  });
});

test("baseline completion does not regress an existing watermark", async () => {
  const { completeBaseline } = await import("@/lib/scraper/incremental/lifecycle-commit");
  source.lifecycleMode = M.BASELINE;
  source.watermarkAt = new Date("2026-07-30T00:00:00.000Z");
  source.watermarkKey = "v1:newer";
  txSource = source;

  assert.deepEqual(
    await completeBaseline({
      ...base,
      segments: [{ segmentId: "segment-1", boundaryReached: true, pagesFullyProcessed: true }],
      initialWatermark: {
        at: new Date("2026-07-29T00:00:00.000Z"),
        key: "v1:older",
      },
    }),
    { committed: true, mode: M.SHADOW },
  );
});
