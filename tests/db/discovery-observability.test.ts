/**
 * Discovery-source observability + auto-degradation integration tests (#1089,
 * Phase 1.9).
 *
 * Engine-agnostic like `lifecycle.test.ts` / `page-commit.test.ts`: runs on
 * SQLite by default under `npm run test:db`, PostgreSQL in CI, guarded by
 * `enabled` (RUN_DB_INTEGRATION=1). They exercise the REAL query + degradation
 * persistence against the live database and prove the Phase 1.9 guarantees:
 *
 *   - AC1: the query layer computes candidate rollups + the derived operational
 *     status directly from persisted rows;
 *   - AC3: a sustained HTTP-200/zero-discovery drift (`evaluateAndApplyDegradation`)
 *     demotes an ACTIVE source to SHADOW WITHOUT touching candidate/watermark
 *     state, and the source is fully recoverable (SHADOW→ACTIVE) afterwards;
 *   - the admin lifecycle-action dispatcher (`applyLifecycleAction`) applies a
 *     guarded pause on an idle source and refuses one held by a worker.
 *
 * All rows are PREFIX-scoped and swept by the shared integration cleanup.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CrawlCandidateStatus,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  evaluateAndApplyDegradation,
  getDiscoverySourceMetrics,
} from "@/lib/scraper/incremental/observability-query";
import { applyLifecycleAction } from "@/lib/scraper/incremental/lifecycle-actions";
import { DEFAULT_DEGRADATION_THRESHOLDS } from "@/lib/scraper/incremental/degradation";
import { transitionDiscoveryLifecycle } from "@/lib/scraper/incremental/lifecycle-commit";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { SHADOW, ACTIVE, PAUSED } = DiscoverySourceLifecycleMode;
const DAY_MS = 24 * 60 * 60 * 1000;

test("AC1: query layer computes candidate rollups + operational status", { skip: !enabled }, async () => {
  const now = new Date();
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    health: DiscoverySourceHealth.HEALTHY,
    watermarkAt: new Date(now.getTime() - DAY_MS),
    baselineCompletedAt: new Date(now.getTime() - 30 * DAY_MS),
    activatedAt: new Date(now.getTime() - 20 * DAY_MS),
    lastRunAt: new Date(now.getTime() - 60_000),
  });
  await createCrawlCandidate({ discoverySourceId: source.id, providerKey: source.providerKey, status: CrawlCandidateStatus.QUEUED });
  await createCrawlCandidate({ discoverySourceId: source.id, providerKey: source.providerKey, status: CrawlCandidateStatus.INGESTED });

  const dto = await getDiscoverySourceMetrics(source.id, now);
  assert.ok(dto);
  assert.equal(dto.metrics.totalCandidates, 2);
  assert.equal(dto.metrics.backlogCount, 1);
  assert.equal(dto.metrics.status, "healthy-backlog");
});

test("AC3: sustained zero-discovery drift demotes ACTIVE→SHADOW, preserving state + reversible", { skip: !enabled }, async () => {
  const now = new Date();
  const leaseOwner = "worker-obs-1";
  const watermarkAt = new Date(now.getTime() - DAY_MS);
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    health: DiscoverySourceHealth.HEALTHY,
    leaseOwner,
    leaseAcquiredAt: now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    watermarkAt,
    watermarkKey: "v1:frontier",
    checkpointCursor: "cursor-42",
    checkpointPage: 7,
    baselineCompletedAt: new Date(now.getTime() - 30 * DAY_MS),
    activatedAt: new Date(now.getTime() - 20 * DAY_MS),
  });
  const candidate = await createCrawlCandidate({
    discoverySourceId: source.id,
    providerKey: source.providerKey,
    status: CrawlCandidateStatus.INGESTED,
  });

  const result = await evaluateAndApplyDegradation({
    source: {
      id: source.id,
      providerKey: source.providerKey,
      lifecycleMode: ACTIVE,
      leaseOwner,
      definitionVersion: source.definitionVersion,
      watermarkAt,
      consecutiveFailures: 0,
    },
    zeroDiscoveryStreak: DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak,
    now,
  });

  assert.equal(result.demoted, true);
  assert.equal(result.reason, "zero-discovery-drift");

  const after = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(after.lifecycleMode, SHADOW, "demoted to shadow");
  // State-preserving: checkpoint + watermark are untouched.
  assert.equal(after.checkpointCursor, "cursor-42");
  assert.equal(after.checkpointPage, 7);
  assert.equal(after.watermarkKey, "v1:frontier");
  assert.equal(after.watermarkAt?.getTime(), watermarkAt.getTime());
  // Candidate is untouched.
  const candAfter = await prisma.crawlCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(candAfter.status, CrawlCandidateStatus.INGESTED);

  // Reversible: SHADOW→ACTIVE re-activates via the normal lifecycle transition.
  const reactivate = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: after.leaseOwner,
    definitionVersion: after.definitionVersion,
    targetMode: ACTIVE,
    now,
  });
  assert.equal(reactivate.committed, true);
  const revived = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(revived.lifecycleMode, ACTIVE);
});

test("AC3: within-threshold drift keeps the source ACTIVE", { skip: !enabled }, async () => {
  const now = new Date();
  const leaseOwner = "worker-obs-2";
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner,
    leaseAcquiredAt: now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    watermarkAt: new Date(now.getTime() - DAY_MS),
  });

  const result = await evaluateAndApplyDegradation({
    source: {
      id: source.id,
      providerKey: source.providerKey,
      lifecycleMode: ACTIVE,
      leaseOwner,
      definitionVersion: source.definitionVersion,
      watermarkAt: new Date(now.getTime() - DAY_MS),
      consecutiveFailures: 0,
    },
    zeroDiscoveryStreak: DEFAULT_DEGRADATION_THRESHOLDS.maxZeroDiscoveryStreak - 1,
    now,
  });

  assert.equal(result.demoted, false);
  const after = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(after.lifecycleMode, ACTIVE);
});

test("admin action: pause an idle source; refuse a worker-held source", { skip: !enabled }, async () => {
  const idle = await createDiscoverySource({ lifecycleMode: ACTIVE, leaseOwner: null });
  const paused = await applyLifecycleAction(idle.id, "pause");
  assert.equal(paused.ok, true);
  assert.equal(paused.ok && paused.toMode, PAUSED);

  const busy = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: "worker-busy",
    leaseAcquiredAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 60_000),
  });
  const refused = await applyLifecycleAction(busy.id, "pause");
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, "busy");
});
