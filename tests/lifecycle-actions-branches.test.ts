process.env.LOG_LEVEL = "error";

import assert from "node:assert/strict";
import { before, beforeEach, mock, test } from "node:test";
import { DiscoverySourceLifecycleMode } from "@prisma/client";

const M = DiscoverySourceLifecycleMode;

type SourceRow = {
  providerKey: string;
  sourceKey: string;
  lifecycleMode: DiscoverySourceLifecycleMode;
  leaseOwner: string | null;
  definitionVersion: number;
  baselineCompletedAt: Date | null;
};

let source: SourceRow | null;
let canary = false;
let beginResult: Record<string, unknown>;
let activateResult: Record<string, unknown>;
let transitionResult: Record<string, unknown>;
let rollbackResult: Record<string, unknown>;
let lastActivateInput: Record<string, unknown> | null;
let lastTransitionInput: Record<string, unknown> | null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        discoverySource: {
          findUnique: async () => source,
        },
      },
    },
  });
  mock.module("@/lib/scraper/incremental/canaries", {
    namedExports: {
      isCanarySource: () => canary,
    },
  });
  mock.module("@/lib/scraper/incremental/canary-exit-gate-eval", {
    namedExports: {
      canaryExitGateGuard: () => "synthetic-exit-gate",
    },
  });
  mock.module("@/lib/scraper/incremental/lifecycle-commit", {
    namedExports: {
      beginBaseline: async () => beginResult,
      activateDiscoverySource: async (input: Record<string, unknown>) => {
        lastActivateInput = input;
        return activateResult;
      },
      transitionDiscoveryLifecycle: async (input: Record<string, unknown>) => {
        lastTransitionInput = input;
        return transitionResult;
      },
    },
  });
  mock.module("@/lib/scraper/incremental/rollback-commit", {
    namedExports: {
      rollbackActiveToShadow: async () => rollbackResult,
    },
  });
});

beforeEach(() => {
  source = {
    providerKey: "provider-1",
    sourceKey: "source-1",
    lifecycleMode: M.DISABLED,
    leaseOwner: null,
    definitionVersion: 1,
    baselineCompletedAt: null,
  };
  canary = false;
  beginResult = { committed: true, mode: M.BASELINE };
  activateResult = {
    committed: true,
    mode: M.ACTIVE,
    queuedCount: 2,
    deferredCount: 1,
  };
  transitionResult = { committed: true, mode: M.PAUSED };
  rollbackResult = {
    committed: true,
    fromMode: M.ACTIVE,
    toMode: M.SHADOW,
    cancelledJobCount: 3,
    activationGeneration: 4,
  };
  lastActivateInput = null;
  lastTransitionInput = null;
});

async function loadActions() {
  return import("@/lib/scraper/incremental/lifecycle-actions");
}

test("lifecycle actions fail closed for missing and busy sources", async () => {
  const { applyLifecycleAction } = await loadActions();
  source = null;
  assert.deepEqual(await applyLifecycleAction("source-1", "pause"), {
    ok: false,
    reason: "source-not-found",
  });

  source = {
    providerKey: "provider-1",
    sourceKey: "source-1",
    lifecycleMode: M.ACTIVE,
    leaseOwner: "worker-1",
    definitionVersion: 1,
    baselineCompletedAt: new Date(),
  };
  assert.deepEqual(await applyLifecycleAction("source-1", "pause"), {
    ok: false,
    reason: "busy",
  });
});

test("begin-baseline maps guarded commit success and failure", async () => {
  const { applyLifecycleAction } = await loadActions();
  beginResult = { committed: false, reason: "lease-lost" };
  assert.deepEqual(await applyLifecycleAction("source-1", "begin-baseline"), {
    ok: false,
    reason: "lease-lost",
  });

  beginResult = { committed: true, mode: M.BASELINE };
  assert.deepEqual(await applyLifecycleAction("source-1", "begin-baseline"), {
    ok: true,
    action: "begin-baseline",
    fromMode: M.DISABLED,
    toMode: M.BASELINE,
  });
});

test("activate attaches canary guards and preserves sanitized failure details", async () => {
  const { applyLifecycleAction } = await loadActions();
  source!.lifecycleMode = M.SHADOW;
  canary = true;
  activateResult = {
    committed: false,
    reason: "exit-gates-failed",
    failingGates: ["soak-duration"],
    credentialEligibility: "stable-identity-required",
  };

  assert.deepEqual(await applyLifecycleAction("source-1", "activate"), {
    ok: false,
    reason: "exit-gates-failed",
    failingGates: ["soak-duration"],
    credentialEligibility: "stable-identity-required",
  });
  assert.equal(lastActivateInput?.exitGateGuard, "synthetic-exit-gate");

  canary = false;
  activateResult = {
    committed: true,
    mode: M.ACTIVE,
    queuedCount: 2,
    deferredCount: 1,
  };
  assert.deepEqual(await applyLifecycleAction("source-1", "activate"), {
    ok: true,
    action: "activate",
    fromMode: M.SHADOW,
    toMode: M.ACTIVE,
    queuedCount: 2,
    deferredCount: 1,
  });
  assert.equal("exitGateGuard" in (lastActivateInput ?? {}), false);
});

test("transition actions resolve every target and propagate commit failures", async () => {
  const { applyLifecycleAction } = await loadActions();

  transitionResult = { committed: false, reason: "invalid-transition" };
  source!.lifecycleMode = M.ACTIVE;
  assert.deepEqual(await applyLifecycleAction("source-1", "pause"), {
    ok: false,
    reason: "invalid-transition",
  });
  assert.equal(lastTransitionInput?.targetMode, M.PAUSED);

  transitionResult = { committed: true, mode: M.BASELINE };
  source!.lifecycleMode = M.PAUSED;
  source!.baselineCompletedAt = null;
  await applyLifecycleAction("source-1", "resume");
  assert.equal(lastTransitionInput?.targetMode, M.BASELINE);

  transitionResult = { committed: true, mode: M.SHADOW };
  source!.baselineCompletedAt = new Date();
  await applyLifecycleAction("source-1", "resume");
  assert.equal(lastTransitionInput?.targetMode, M.SHADOW);

  source!.lifecycleMode = M.SHADOW;
  transitionResult = { committed: true, mode: M.BASELINE };
  await applyLifecycleAction("source-1", "rollback");
  assert.equal(lastTransitionInput?.targetMode, M.BASELINE);

  for (const from of [M.BASELINE, M.PAUSED]) {
    source!.lifecycleMode = from;
    transitionResult = { committed: true, mode: M.DISABLED };
    await applyLifecycleAction("source-1", "rollback");
    assert.equal(lastTransitionInput?.targetMode, M.DISABLED);
  }

  source!.lifecycleMode = M.SHADOW;
  await applyLifecycleAction("source-1", "disable");
  assert.equal(lastTransitionInput?.targetMode, M.DISABLED);
  await applyLifecycleAction("source-1", "retire");
  assert.equal(lastTransitionInput?.targetMode, M.RETIRED);

  source!.lifecycleMode = M.DISABLED;
  assert.deepEqual(await applyLifecycleAction("source-1", "rollback"), {
    ok: false,
    reason: "invalid-transition",
  });
});

test("active rollback maps the atomic rollback commit", async () => {
  const { applyLifecycleAction } = await loadActions();
  source!.lifecycleMode = M.ACTIVE;
  rollbackResult = { committed: false, reason: "lease-lost" };
  assert.deepEqual(await applyLifecycleAction("source-1", "rollback"), {
    ok: false,
    reason: "lease-lost",
  });

  rollbackResult = {
    committed: true,
    fromMode: M.ACTIVE,
    toMode: M.SHADOW,
    cancelledJobCount: 3,
    activationGeneration: 4,
  };
  assert.deepEqual(await applyLifecycleAction("source-1", "rollback"), {
    ok: true,
    action: "rollback",
    fromMode: M.ACTIVE,
    toMode: M.SHADOW,
    cancelledJobCount: 3,
    activationGeneration: 4,
  });
});
