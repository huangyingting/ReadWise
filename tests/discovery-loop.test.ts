/**
 * Unit tests for the sibling discovery scheduling loop (issue #1087).
 *
 * Pure and network/DB-free: prisma is mocked and the claim + run seams are
 * injected. Proves the loop drains due sources, isolates a failing source (the
 * loop keeps going), and stops on `once` mode / abort — all under the SAME
 * worker runtime (no second daemon).
 */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

import type {
  ClaimDiscoveryOptions,
  ClaimedDiscoverySource,
} from "@/lib/scraper/incremental/discovery-claim";
import type { DiscoveryRunOutcome } from "@/lib/scraper/incremental/discovery-run";
import type { DiscoveryLoopDeps } from "@/lib/worker/discovery-loop";

process.env.LOG_LEVEL = "error";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function claimed(id: string): ClaimedDiscoverySource {
  return {
    source: { id, leaseOwner: "worker-x", definitionVersion: 1 } as ClaimedDiscoverySource["source"],
    wasStale: false,
  };
}

function makeDeps(
  queue: Array<ClaimedDiscoverySource | null>,
  runResults: (source: ClaimedDiscoverySource) => DiscoveryRunOutcome,
  ran: string[],
): DiscoveryLoopDeps {
  return {
    fetchPage: async () => {
      throw new Error("fetchPage must not be called when runClaimedDiscoverySource is injected");
    },
    claimDueDiscoverySource: async (_workerId: string, _opts?: ClaimDiscoveryOptions) =>
      queue.length > 0 ? queue.shift()! : null,
    runClaimedDiscoverySource: async (claim: ClaimedDiscoverySource) => {
      ran.push(claim.source.id);
      return runResults(claim);
    },
  };
}

test("discovery loop drains due sources and tallies outcomes (once mode)", async () => {
  const { runDiscoveryLoop } = await import("@/lib/worker/discovery-loop");
  const ran: string[] = [];
  const deps = makeDeps(
    [claimed("s1"), claimed("s2"), null],
    (claim) => ({
      status: "committed",
      itemsCommitted: 3,
      boundaryReached: claim.source.id === "s2",
      caughtUp: claim.source.id === "s2",
    }),
    ran,
  );

  const stats = await runDiscoveryLoop("worker-x", { once: true }, silentLogger, deps);

  assert.deepEqual(ran, ["s1", "s2"]);
  assert.equal(stats.claimed, 2);
  assert.equal(stats.committed, 2);
  assert.equal(stats.failed, 0);
});

test("a failing source is isolated: the loop keeps draining the rest", async () => {
  const { runDiscoveryLoop } = await import("@/lib/worker/discovery-loop");
  const ran: string[] = [];
  const deps = makeDeps(
    [claimed("bad"), claimed("good"), null],
    (claim) =>
      claim.source.id === "bad"
        ? { status: "failed", errorKind: "Error" }
        : { status: "committed", itemsCommitted: 1, boundaryReached: true, caughtUp: true },
    ran,
  );

  const stats = await runDiscoveryLoop("worker-x", { once: true }, silentLogger, deps);

  assert.deepEqual(ran, ["bad", "good"], "the failing source must not stop the loop");
  assert.equal(stats.failed, 1);
  assert.equal(stats.committed, 1);
});

test("a lost lease is tallied without stopping the loop", async () => {
  const { runDiscoveryLoop } = await import("@/lib/worker/discovery-loop");
  const ran: string[] = [];
  const deps = makeDeps(
    [claimed("stolen"), claimed("ok"), null],
    (claim) =>
      claim.source.id === "stolen"
        ? { status: "lease-lost" }
        : { status: "committed", itemsCommitted: 1, boundaryReached: true, caughtUp: true },
    ran,
  );

  const stats = await runDiscoveryLoop("worker-x", { once: true }, silentLogger, deps);

  assert.equal(stats.leaseLost, 1);
  assert.equal(stats.committed, 1);
});

test("an already-aborted signal stops the loop before any claim", async () => {
  const { runDiscoveryLoop } = await import("@/lib/worker/discovery-loop");
  const ran: string[] = [];
  const controller = new AbortController();
  controller.abort();
  const deps = makeDeps([claimed("s1"), null], () => ({ status: "lease-lost" }), ran);

  const stats = await runDiscoveryLoop(
    "worker-x",
    { once: true, signal: controller.signal },
    silentLogger,
    deps,
  );

  assert.equal(stats.stoppedBySignal, true);
  assert.deepEqual(ran, []);
});
