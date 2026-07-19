/**
 * Frontier-state commit integration tests (#1086, Phase 1.6).
 *
 * Engine-agnostic like `page-commit.test.ts`: runs on SQLite by default under
 * `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). They exercise the real `commitFrontierState` against
 * the live database and prove:
 *
 *   - a computed watermark / gap / validator / health decision is persisted
 *     atomically onto `DiscoverySource`;
 *   - the watermark NEVER regresses;
 *   - entering `DETECTED` stamps `gapDetectedAt` once + records a note, and
 *     clearing to `NONE` resets both;
 *   - a disabled/stale validator clears `validatorVersion`;
 *   - a lost lease/version (before OR during the commit) never writes;
 *   - a lease stolen mid-commit aborts the guarded update and rolls back.
 *
 * Discovery sources are PREFIX-scoped and swept by the shared cleanup.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscoveryGapState, DiscoverySourceHealth, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { commitFrontierState } from "@/lib/scraper/incremental/frontier-commit";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const LEASE = "worker-1";

async function activeSource(overrides = {}) {
  return createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner: LEASE,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Happy path: watermark + gap + validator + health persisted atomically.
// ---------------------------------------------------------------------------

test("commits the full frontier decision atomically", { skip: !enabled }, async () => {
  const source = await activeSource();
  const at = new Date("2024-06-20T00:00:00.000Z");
  const runAt = new Date("2024-07-01T00:00:00.000Z");

  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    now: runAt,
    decision: {
      watermark: { at, key: "v1:abc" },
      gap: { state: DiscoveryGapState.NONE, note: null },
      validator: { version: "validator-2" },
      health: DiscoverySourceHealth.HEALTHY,
      runAt,
    },
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.watermarkAdvanced, true);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.watermarkAt?.getTime(), at.getTime());
  assert.equal(row?.watermarkKey, "v1:abc");
  assert.equal(row?.validatorVersion, "validator-2");
  assert.equal(row?.health, DiscoverySourceHealth.HEALTHY);
  assert.equal(row?.lastRunAt?.getTime(), runAt.getTime());
  assert.equal(row?.gapState, DiscoveryGapState.NONE);
});

// ---------------------------------------------------------------------------
// Watermark never regresses.
// ---------------------------------------------------------------------------

test("a lower proposed watermark never regresses the proven one", { skip: !enabled }, async () => {
  const proven = new Date("2024-06-15T00:00:00.000Z");
  const source = await activeSource({ watermarkAt: proven, watermarkKey: "v1:hi" });

  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    decision: { watermark: { at: new Date("2024-06-01T00:00:00.000Z"), key: "v1:old" } },
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.watermarkAdvanced, false);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.watermarkAt?.getTime(), proven.getTime(), "watermark unchanged");
  assert.equal(row?.watermarkKey, "v1:hi");
});

test("a same-timestamp greater key advances; a smaller key does not", { skip: !enabled }, async () => {
  const at = new Date("2024-06-15T00:00:00.000Z");
  const source = await activeSource({ watermarkAt: at, watermarkKey: "v1:m" });

  const lower = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    decision: { watermark: { at, key: "v1:a" } },
  });
  assert.equal(lower.committed && lower.watermarkAdvanced, false);

  const higher = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    decision: { watermark: { at, key: "v1:z" } },
  });
  assert.equal(higher.committed && higher.watermarkAdvanced, true);
  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.watermarkKey, "v1:z");
});

// ---------------------------------------------------------------------------
// Gap: DETECTED stamps once + records note; NONE resets.
// ---------------------------------------------------------------------------

test("entering DETECTED stamps gapDetectedAt once and records a note; NONE resets", { skip: !enabled }, async () => {
  const source = await activeSource();
  const firstRun = new Date("2024-07-01T00:00:00.000Z");

  const detected = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    now: firstRun,
    decision: { gap: { state: DiscoveryGapState.DETECTED, note: "manual-backfill-suggested: rolled window" } },
  });
  assert.equal(detected.committed, true);

  let row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.gapState, DiscoveryGapState.DETECTED);
  assert.equal(row?.gapDetectedAt?.getTime(), firstRun.getTime());
  assert.ok(row?.gapNote?.includes("manual-backfill-suggested"));

  // A second DETECTED run keeps the ORIGINAL detection timestamp.
  const secondRun = new Date("2024-07-02T00:00:00.000Z");
  await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    now: secondRun,
    decision: { gap: { state: DiscoveryGapState.DETECTED, note: "still rolled" } },
  });
  row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.gapDetectedAt?.getTime(), firstRun.getTime(), "detection time is stamped once");

  // Clearing to NONE resets the note + timestamp.
  await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    decision: { gap: { state: DiscoveryGapState.NONE, note: null } },
  });
  row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.gapState, DiscoveryGapState.NONE);
  assert.equal(row?.gapDetectedAt, null);
  assert.equal(row?.gapNote, null);
});

// ---------------------------------------------------------------------------
// Validator disable clears the fingerprint.
// ---------------------------------------------------------------------------

test("disabling a stale validator clears validatorVersion", { skip: !enabled }, async () => {
  const source = await activeSource({ validatorVersion: "validator-1" });

  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    decision: { validator: { disable: true } },
  });
  assert.equal(result.committed && result.validatorDisabled, true);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.validatorVersion, null);
});

// ---------------------------------------------------------------------------
// Lease / version validation.
// ---------------------------------------------------------------------------

test("lease lost before commit → no writes", { skip: !enabled }, async () => {
  const at = new Date("2024-06-20T00:00:00.000Z");
  const source = await activeSource({ leaseOwner: "worker-A" });

  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: "worker-B", // stolen
    definitionVersion: source.definitionVersion,
    decision: { watermark: { at, key: "v1:x" } },
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "lease-lost");
  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.watermarkAt, null, "nothing persisted");
});

test("definitionVersion mismatch before commit → lease-lost", { skip: !enabled }, async () => {
  const source = await activeSource({ definitionVersion: 3 });
  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: 2, // stale
    decision: { watermark: { at: new Date("2024-06-20T00:00:00.000Z"), key: "v1:x" } },
  });
  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "lease-lost");
});

test("source not found → source-not-found", { skip: !enabled }, async () => {
  const result = await commitFrontierState({
    sourceId: "does-not-exist",
    leaseOwner: LEASE,
    definitionVersion: 1,
    decision: { gap: { state: DiscoveryGapState.NONE, note: null } },
  });
  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "source-not-found");
});

test("lease stolen mid-commit → guarded update aborts and rolls back", { skip: !enabled }, async () => {
  const at = new Date("2024-06-20T00:00:00.000Z");
  const source = await activeSource({ leaseOwner: "worker-A" });

  const result = await commitFrontierState({
    sourceId: source.id,
    leaseOwner: "worker-A",
    definitionVersion: source.definitionVersion,
    decision: { watermark: { at, key: "v1:x" } },
    debugHooks: {
      // Steal the lease inside the transaction right before the guarded update;
      // the update's WHERE no longer matches → whole tx rolls back.
      beforeUpdate: async (tx) => {
        await tx.discoverySource.update({
          where: { id: source.id },
          data: { leaseOwner: "thief" },
        });
      },
    },
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "lease-lost");
  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.watermarkAt, null, "watermark never persisted");
  assert.equal(row?.leaseOwner, "worker-A", "the lease steal rolled back with the aborted tx");
});
