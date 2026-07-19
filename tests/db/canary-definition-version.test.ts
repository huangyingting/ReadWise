/**
 * Phase-1.10 definition-VERSION replacement + rollback integration tests (issue
 * #1090, AC3).
 *
 * Engine-agnostic (SQLite by default, PostgreSQL in CI), guarded by `enabled`.
 * Proves the mechanism that lets a new source-definition version run
 * INDEPENDENTLY in shadow and roll back to the retained prior version, WITHOUT a
 * schema change — each version is a distinct `DiscoverySource` row keyed by the
 * existing `@@unique([providerKey, sourceKey, definitionVersion])`:
 *
 *   - `replaceDefinitionVersion` creates a NEW version row (definitionVersion+1)
 *     seeded DISABLED — its OWN lease/checkpoint/ledger — leaving the prior row
 *     completely untouched (retained + restorable).
 *   - `rollbackDefinitionVersion` RETIRES the newest non-retired version and
 *     leaves the prior version intact; a family with only one live version has
 *     nothing to roll back to.
 *
 * Sources use PREFIX-scoped provider keys so the shared sweep removes them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscoverySourceLifecycleMode, DiscoverySourceRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  readDefinitionVersions,
  replaceDefinitionVersion,
  rollbackDefinitionVersion,
} from "@/lib/scraper/incremental/definition-version";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { DISABLED, SHADOW, RETIRED } = DiscoverySourceLifecycleMode;

test("replaceDefinitionVersion creates an independent DISABLED shadow row and retains the prior version", { skip: !enabled }, async () => {
  const providerKey = id("prov");
  const sourceKey = "family";
  const prior = await createDiscoverySource({
    providerKey,
    sourceKey,
    definitionVersion: 1,
    role: DiscoverySourceRole.SITEMAP,
    lifecycleMode: SHADOW,
    pollIntervalSeconds: 3600,
    discoveryBudgetPerRun: 150,
  });

  const result = await replaceDefinitionVersion({ providerKey, sourceKey });
  assert.equal(result.created, true);
  if (!result.created) return;
  assert.equal(result.priorVersion, 1);
  assert.equal(result.newVersion, 2);

  // The new version is a distinct row: DISABLED, own id, copied config.
  const created = await prisma.discoverySource.findUnique({ where: { id: result.newSourceId } });
  assert.equal(created?.definitionVersion, 2);
  assert.equal(created?.lifecycleMode, DISABLED, "a replacement begins its own baseline in DISABLED");
  assert.equal(created?.role, DiscoverySourceRole.SITEMAP, "role copied from prior version");
  assert.equal(created?.pollIntervalSeconds, 3600, "schedule copied from prior version");
  assert.equal(created?.discoveryBudgetPerRun, 150, "budget copied from prior version");
  assert.notEqual(created?.id, prior.id, "the new version is an independent row");

  // The prior version is RETAINED untouched (still SHADOW).
  const priorAfter = await prisma.discoverySource.findUnique({ where: { id: prior.id } });
  assert.equal(priorAfter?.lifecycleMode, SHADOW, "prior version retained + unchanged");

  const versions = await readDefinitionVersions(providerKey, sourceKey);
  assert.deepEqual(versions.map((v) => v.definitionVersion), [1, 2]);
});

test("rollbackDefinitionVersion retires the newest version and leaves the prior version restorable", { skip: !enabled }, async () => {
  const providerKey = id("prov");
  const sourceKey = "family";
  const prior = await createDiscoverySource({
    providerKey,
    sourceKey,
    definitionVersion: 1,
    lifecycleMode: SHADOW,
    leaseOwner: null,
  });
  const replacement = await createDiscoverySource({
    providerKey,
    sourceKey,
    definitionVersion: 2,
    lifecycleMode: SHADOW,
    leaseOwner: null,
  });

  const result = await rollbackDefinitionVersion({ providerKey, sourceKey });
  assert.equal(result.rolledBack, true);
  if (!result.rolledBack) return;
  assert.equal(result.retiredVersion, 2);
  assert.equal(result.restoredVersion, 1);
  assert.equal(result.restoredSourceId, prior.id);

  const newer = await prisma.discoverySource.findUnique({ where: { id: replacement.id } });
  assert.equal(newer?.lifecycleMode, RETIRED, "the newer version is retired");

  const older = await prisma.discoverySource.findUnique({ where: { id: prior.id } });
  assert.equal(older?.lifecycleMode, SHADOW, "the prior version is retained + restorable");
});

test("rollbackDefinitionVersion refuses when there is no prior version to restore", { skip: !enabled }, async () => {
  const providerKey = id("prov");
  const sourceKey = "family";
  await createDiscoverySource({
    providerKey,
    sourceKey,
    definitionVersion: 1,
    lifecycleMode: SHADOW,
    leaseOwner: null,
  });

  const result = await rollbackDefinitionVersion({ providerKey, sourceKey });
  assert.equal(result.rolledBack, false);
  if (result.rolledBack) return;
  assert.equal(result.reason, "no-prior-version");
});

test("rollbackDefinitionVersion refuses to retire a lease-held version (guarded)", { skip: !enabled }, async () => {
  const providerKey = id("prov");
  const sourceKey = "family";
  await createDiscoverySource({ providerKey, sourceKey, definitionVersion: 1, lifecycleMode: SHADOW, leaseOwner: null });
  const held = await createDiscoverySource({
    providerKey,
    sourceKey,
    definitionVersion: 2,
    lifecycleMode: SHADOW,
    leaseOwner: "worker-live",
  });

  const result = await rollbackDefinitionVersion({ providerKey, sourceKey });
  assert.equal(result.rolledBack, false, "a version held by a live worker is not retired out from under it");

  const row = await prisma.discoverySource.findUnique({ where: { id: held.id } });
  assert.equal(row?.lifecycleMode, SHADOW, "the lease-held version is untouched");
});
