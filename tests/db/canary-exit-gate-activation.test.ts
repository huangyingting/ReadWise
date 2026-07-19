/**
 * Phase-1.10 exit-gate ACTIVATION ENFORCEMENT integration tests (issue #1090,
 * AC2 — security-critical).
 *
 * Engine-agnostic like the other `tests/db/*` suites: runs on SQLite by default
 * under `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Proves the security invariant: a canary that FAILS a
 * Phase-1 exit gate MUST remain SHADOWED and cannot be promoted to ACTIVE through
 * ANY shortcut.
 *
 *   - `activateDiscoverySource` refuses (`exit-gates-failed`) when the injected
 *     {@link ExitGateGuard} reports a non-passing verdict; the source stays SHADOW.
 *   - A PASSING guard allows the SHADOW → ACTIVE cutover.
 *   - The admin dispatcher `applyLifecycleAction("activate")` on a REAL configured
 *     canary is FAIL-CLOSED: with no soak evidence the `recovery-successful` gate
 *     fails, so the canary cannot reach ACTIVE (the operator must supply proven
 *     recovery evidence — we never relax a gate to force a pass).
 *   - `activate` is the ONLY edge into ACTIVE: `resume` on a paused canary lands
 *     in SHADOW (or BASELINE), never ACTIVE, so gating activation closes every path.
 *
 * Canary sources use the REAL provider/source keys ("theconversation"/"canary-rss")
 * so `isCanarySource` matches; a local afterEach deletes them (the shared PREFIX
 * sweep only removes prefixed provider keys).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { canaryExitGateGuard } from "@/lib/scraper/incremental/canary-exit-gate-eval";
import { CANARIES } from "@/lib/scraper/incremental/canaries";
import {
  activateDiscoverySource,
  type ExitGateGuard,
} from "@/lib/scraper/incremental/lifecycle-commit";
import { applyLifecycleAction } from "@/lib/scraper/incremental/lifecycle-actions";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { SHADOW, ACTIVE, PAUSED } = DiscoverySourceLifecycleMode;

// Canary sources carry REAL (non-prefixed) provider keys, so the shared sweep
// misses them — track their ids and delete them locally.
const createdSourceIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const ids = [...createdSourceIds];
  if (ids.length > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { discoverySourceId: { in: ids } } });
    await prisma.discoverySource.deleteMany({ where: { id: { in: ids } } });
  }
  createdSourceIds.clear();
});

const rssCanary = CANARIES.find((c) => c.channel === "rss")!;

const passingGuard: ExitGateGuard = async () => ({ verdict: "pass", failing: [] });
const failingGuard: ExitGateGuard = async () => ({
  verdict: "fail",
  failing: ["recovery-successful"],
});

test("activation is REFUSED when the exit-gate guard fails; source stays SHADOW", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: SHADOW, leaseOwner: null });

  const result = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: null,
    definitionVersion: source.definitionVersion,
    exitGateGuard: failingGuard,
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "exit-gates-failed");
  assert.deepEqual(result.failingGates, ["recovery-successful"]);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW, "a gate failure keeps the source SHADOWED");
  assert.equal(row?.activatedAt, null, "never stamped activated");
});

test("activation SUCCEEDS when the exit-gate guard passes", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: SHADOW, leaseOwner: null });

  const result = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: null,
    definitionVersion: source.definitionVersion,
    exitGateGuard: passingGuard,
  });

  assert.equal(result.committed, true);
  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE);
  assert.ok(row?.activatedAt);
});

test("applyLifecycleAction('activate') on a real canary is FAIL-CLOSED without soak evidence", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: rssCanary.providerKey,
    sourceKey: rssCanary.sourceKey,
    definitionVersion: rssCanary.definitionVersion,
    role: rssCanary.role,
    lifecycleMode: SHADOW,
    leaseOwner: null,
    baselineCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  createdSourceIds.add(source.id);

  const result = await applyLifecycleAction(source.id, "activate");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "exit-gates-failed");
  // The recovery gate fails when no fault-recovery evidence has been supplied.
  assert.ok((result.failingGates ?? []).includes("recovery-successful"));

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW, "an unproven canary cannot reach ACTIVE");
});

test("the fail-closed canary guard itself reports the recovery gate failing", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: rssCanary.providerKey,
    sourceKey: rssCanary.sourceKey,
    definitionVersion: rssCanary.definitionVersion,
    lifecycleMode: SHADOW,
    leaseOwner: null,
    baselineCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  createdSourceIds.add(source.id);

  const guard = canaryExitGateGuard(source.id, { now: new Date("2026-07-19T00:00:00.000Z") });
  const verdict = await guard();
  assert.equal(verdict.verdict, "fail");
  assert.ok(verdict.failing.length > 0);
});

test("no NON-activate action reaches ACTIVE: resume on a paused canary lands in SHADOW", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: rssCanary.providerKey,
    sourceKey: rssCanary.sourceKey,
    definitionVersion: rssCanary.definitionVersion,
    lifecycleMode: PAUSED,
    leaseOwner: null,
    baselineCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  createdSourceIds.add(source.id);

  const result = await applyLifecycleAction(source.id, "resume");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.toMode, SHADOW, "resume returns to the safe observe-only mode, never ACTIVE");

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.notEqual(row?.lifecycleMode, ACTIVE);
});
