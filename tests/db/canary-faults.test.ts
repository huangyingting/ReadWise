/**
 * Phase-1.10 fault-simulation integration tests (issue #1090 — recovery evidence
 * for the `recovery-successful` exit gate).
 *
 * Engine-agnostic (SQLite by default, PostgreSQL in CI), guarded by `enabled`.
 * Simulates the operational faults a canary must survive and asserts SAFE
 * recovery, reusing the merged guarded-claim / lease-reclaim / version-guard
 * machinery:
 *
 *   - WORKER CRASH / STALE LEASE: a source whose lease expired is reclaimed by a
 *     new worker (`wasStale`), never left stuck.
 *   - ACTIVE LEASE not stolen: a source under a live (unexpired) lease is NOT
 *     reclaimed by another worker.
 *   - LONG OUTAGE: a long-overdue source with an elapsed backoff becomes claimable
 *     again and recovers.
 *   - SOURCE REORDERING: two due sources are claimed in deterministic
 *     (nextRunAt, createdAt) order — no starvation / reordering hazard.
 *   - STALE VALIDATOR / DEFINITION VERSION: a guarded lifecycle commit carrying a
 *     STALE `definitionVersion` is refused (lease-lost), so a stale-definition
 *     worker can never mutate the source.
 *   - DEFINITION-VERSION REPLACEMENT: a replacement version runs on its OWN lease,
 *     independent of the prior version's lease.
 *
 * All rows use PREFIX-scoped provider keys so the shared sweep removes them; every
 * recorded value is metadata only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscoveryAutomationPolicy, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { claimDueDiscoverySource } from "@/lib/scraper/incremental/discovery-claim";
import { transitionDiscoveryLifecycle } from "@/lib/scraper/incremental/lifecycle-commit";
import { replaceDefinitionVersion } from "@/lib/scraper/incremental/definition-version";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { SHADOW, ACTIVE, PAUSED } = DiscoverySourceLifecycleMode;
const SCHEDULED = DiscoveryAutomationPolicy.SCHEDULED;

const NOW = new Date("2026-07-19T12:00:00.000Z");
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago
const WAY_PAST = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // 7d ago

test("worker crash / stale lease: an expired lease is reclaimed by a new worker", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: id("prov"),
    lifecycleMode: SHADOW,
    automationPolicy: SCHEDULED,
    nextRunAt: PAST,
    leaseOwner: "crashed-worker",
    leaseAcquiredAt: WAY_PAST,
    leaseExpiresAt: PAST, // lease already expired
  });

  const claimed = await claimDueDiscoverySource("recovery-worker", { now: NOW });
  assert.ok(claimed, "the stale-leased source is reclaimed");
  assert.equal(claimed?.source.id, source.id);
  assert.equal(claimed?.wasStale, true, "recovery recorded the stale-lease reclaim");
  assert.equal(claimed?.source.leaseOwner, "recovery-worker", "the new worker owns the lease");
});

test("active lease is NOT stolen: a live lease is left to its owner", { skip: !enabled }, async () => {
  await createDiscoverySource({
    providerKey: id("prov"),
    lifecycleMode: SHADOW,
    automationPolicy: SCHEDULED,
    nextRunAt: PAST,
    leaseOwner: "live-worker",
    leaseAcquiredAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000), // unexpired
  });

  const claimed = await claimDueDiscoverySource("other-worker", { now: NOW });
  assert.equal(claimed, null, "a source under a live lease is not reclaimed");
});

test("long outage: a long-overdue source with elapsed backoff is claimable again", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: id("prov"),
    lifecycleMode: ACTIVE,
    automationPolicy: SCHEDULED,
    nextRunAt: WAY_PAST,
    leaseOwner: null,
    backoffUntil: PAST, // backoff already elapsed
  });

  const claimed = await claimDueDiscoverySource("recovery-worker", { now: NOW });
  assert.equal(claimed?.source.id, source.id, "the source recovers and is claimed after the outage");
});

test("source reordering: two due sources are claimed in deterministic nextRunAt order", { skip: !enabled }, async () => {
  const provider = id("prov");
  const older = await createDiscoverySource({
    providerKey: provider,
    sourceKey: "older",
    lifecycleMode: SHADOW,
    automationPolicy: SCHEDULED,
    nextRunAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    leaseOwner: null,
  });
  const newer = await createDiscoverySource({
    providerKey: provider,
    sourceKey: "newer",
    lifecycleMode: SHADOW,
    automationPolicy: SCHEDULED,
    nextRunAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000),
    leaseOwner: null,
  });

  const first = await claimDueDiscoverySource("worker-a", { now: NOW });
  const second = await claimDueDiscoverySource("worker-b", { now: NOW });
  // The most-overdue source (earliest nextRunAt) is claimed first — no reordering.
  assert.equal(first?.source.id, older.id);
  assert.equal(second?.source.id, newer.id);
});

test("stale validator / definition version: a guarded commit with a stale version is refused", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    providerKey: id("prov"),
    lifecycleMode: ACTIVE,
    leaseOwner: null,
    definitionVersion: 2,
  });

  // A worker still running the OLD definition (version 1) attempts a transition.
  const result = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: null,
    definitionVersion: 1, // stale — the row is on version 2
    targetMode: PAUSED,
  });
  assert.equal(result.committed, false, "a stale-definition commit is refused");

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE, "the source is untouched by the stale worker");
});

test("definition-version replacement runs on an independent lease from the prior version", { skip: !enabled }, async () => {
  const provider = id("prov");
  const sourceKey = "family";
  const prior = await createDiscoverySource({
    providerKey: provider,
    sourceKey,
    definitionVersion: 1,
    lifecycleMode: ACTIVE,
    automationPolicy: SCHEDULED,
    nextRunAt: PAST,
    leaseOwner: "worker-v1",
    leaseAcquiredAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
  });

  const replaced = await replaceDefinitionVersion({ providerKey: provider, sourceKey });
  assert.equal(replaced.created, true);
  if (!replaced.created) return;

  // The prior version keeps its live lease; the new version has none of its own.
  const priorRow = await prisma.discoverySource.findUnique({ where: { id: prior.id } });
  assert.equal(priorRow?.leaseOwner, "worker-v1", "prior version retains its independent lease");
  const newRow = await prisma.discoverySource.findUnique({ where: { id: replaced.newSourceId } });
  assert.equal(newRow?.leaseOwner, null, "the replacement version starts with its own (empty) lease");
  assert.notEqual(newRow?.id, prior.id);
});
