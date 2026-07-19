/**
 * Source-trust promotion/demotion integration tests (#1100, Phase 3.1).
 *
 * Engine-agnostic like `lifecycle.test.ts`: runs on SQLite under `npm run
 * test:db`, PostgreSQL in CI, guarded by `enabled` (RUN_DB_INTEGRATION=1). They
 * exercise the REAL guarded trust commit (`source-trust-commit.ts`) against the
 * live database and prove the #1100 guarantees:
 *
 *   - promotion is EXPLICIT + eligibility-gated (a clean, well-sampled source
 *     promotes; an under-sampled one is refused with hard blockers) and
 *     version-scoped (a mismatched definitionVersion is refused);
 *   - promotion is idempotent (a second promote changes nothing);
 *   - a manual demote only clears the trust flag (lifecycle mode untouched);
 *   - drift auto-demotion (`evaluateAndApplyTrustDemotion`) revokes trust AND
 *     returns an ACTIVE source to SHADOW WITHOUT deleting any candidate history
 *     (AC3): the candidate rows survive, only the mode + flag change.
 *
 * All rows are PREFIX-scoped (`dbit_`) via the fixtures, so the shared cleanup
 * sweep removes them; this file adds no un-swept rows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { CrawlCandidateStatus, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  demoteSourceTrust,
  evaluateAndApplyTrustDemotion,
  promoteSourceTrust,
} from "@/lib/scraper/incremental/source-trust-commit";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { ACTIVE, SHADOW } = DiscoverySourceLifecycleMode;
const { INGESTED, SKIPPED_REVIEW, DISCOVERED } = CrawlCandidateStatus;
const LEASE = "worker-trust-1";

/**
 * Seeds a comfortably-eligible candidate mix on a source: 18 accepted (INGESTED)
 * + 2 review-rejected (SKIPPED_REVIEW) + 5 undecided (DISCOVERED) = 25 total, 20
 * decided, 90% approval, ZERO pre-baseline false positives.
 */
async function seedEligibleCandidates(sourceId: string): Promise<void> {
  const rows: Promise<unknown>[] = [];
  for (let i = 0; i < 18; i += 1) rows.push(createCrawlCandidate({ discoverySourceId: sourceId, status: INGESTED }));
  for (let i = 0; i < 2; i += 1) rows.push(createCrawlCandidate({ discoverySourceId: sourceId, status: SKIPPED_REVIEW }));
  for (let i = 0; i < 5; i += 1) rows.push(createCrawlCandidate({ discoverySourceId: sourceId, status: DISCOVERED }));
  await Promise.all(rows);
}

// ---------------------------------------------------------------------------
// Explicit, eligibility-gated promotion.
// ---------------------------------------------------------------------------

test("promote flips autoPublishTrusted on for a clean, well-sampled, eligible source", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 3, autoPublishTrusted: false });
  await seedEligibleCandidates(source.id);

  const result = await promoteSourceTrust({ sourceId: source.id, definitionVersion: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.changed, true);
  assert.equal(result.ok && result.after.autoPublishTrusted, true);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.autoPublishTrusted, true, "trust flag persisted");
});

test("promote is idempotent — a second promote changes nothing and writes no new state", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 1, autoPublishTrusted: false });
  await seedEligibleCandidates(source.id);

  await promoteSourceTrust({ sourceId: source.id, definitionVersion: 1 });
  const second = await promoteSourceTrust({ sourceId: source.id, definitionVersion: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.changed, false, "already-trusted promote is a no-op");
});

test("promote is REFUSED for an under-sampled source and reports hard blockers (never auto-promotes)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 1, autoPublishTrusted: false });
  // Only 3 candidates — below the sample + decision floors.
  await createCrawlCandidate({ discoverySourceId: source.id, status: INGESTED });
  await createCrawlCandidate({ discoverySourceId: source.id, status: DISCOVERED });
  await createCrawlCandidate({ discoverySourceId: source.id, status: DISCOVERED });

  const result = await promoteSourceTrust({ sourceId: source.id, definitionVersion: 1 });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "ineligible");
  assert.ok(!result.ok && result.blockers && result.blockers.includes("insufficient-sample"));

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.autoPublishTrusted, false, "an ineligible source is never trusted");
});

test("promote is version-scoped — a mismatched definitionVersion is refused", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 4, autoPublishTrusted: false });
  await seedEligibleCandidates(source.id);

  const result = await promoteSourceTrust({ sourceId: source.id, definitionVersion: 3 });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "version-mismatch");

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.autoPublishTrusted, false);
});

// ---------------------------------------------------------------------------
// Manual demote (flag only) + reversibility.
// ---------------------------------------------------------------------------

test("manual demote clears the trust flag but leaves the lifecycle mode untouched", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 1, autoPublishTrusted: true });

  const result = await demoteSourceTrust({ sourceId: source.id, definitionVersion: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.changed, true);
  assert.equal(result.ok && result.after.autoPublishTrusted, false);
  assert.equal(result.ok && result.toMode, undefined, "manual demote does not roll the lifecycle mode");

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.autoPublishTrusted, false);
  assert.equal(row?.lifecycleMode, ACTIVE, "lifecycle mode unchanged by a manual demote");
});

test("demote is idempotent — a second demote on an untrusted source changes nothing", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 1, autoPublishTrusted: false });
  const result = await demoteSourceTrust({ sourceId: source.id, definitionVersion: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.changed, false);
});

// ---------------------------------------------------------------------------
// AC3: drift auto-demotion preserves candidate history.
// ---------------------------------------------------------------------------

test("drift auto-demotion revokes trust + rolls ACTIVE → SHADOW WITHOUT deleting candidate history (AC3)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    definitionVersion: 1,
    autoPublishTrusted: true,
    leaseOwner: LEASE,
    baselineStartedAt: new Date("2024-01-01T00:00:00.000Z"),
    baselineCompletedAt: new Date("2024-01-02T00:00:00.000Z"),
    watermarkAt: new Date("2024-01-02T00:00:00.000Z"),
  });

  // A governing-invariant violation: a PRE-BASELINE identity that became work.
  // This is a hard, zero-tolerance auto-demotion trigger.
  const oldItem = await createCrawlCandidate({
    discoverySourceId: source.id,
    status: INGESTED,
    observedInBaseline: true,
  });
  // Plus ordinary history that must SURVIVE the demotion.
  const kept = await createCrawlCandidate({ discoverySourceId: source.id, status: INGESTED });

  const row = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  const result = await evaluateAndApplyTrustDemotion({ source: row, zeroDiscoveryStreak: 0, now: new Date() });

  assert.equal(result.demoted, true);
  assert.ok(result.reasons.includes("old-item-false-positive"), "the false positive is the demotion reason");

  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.autoPublishTrusted, false, "trust revoked");
  assert.equal(after?.lifecycleMode, SHADOW, "an ACTIVE source is returned to SHADOW (reversible)");

  // AC3: candidate history is preserved — nothing is deleted.
  assert.ok(await prisma.crawlCandidate.findUnique({ where: { id: oldItem.id } }), "the false-positive candidate row survives");
  assert.ok(await prisma.crawlCandidate.findUnique({ where: { id: kept.id } }), "ordinary candidate history survives");
});

test("an untrusted source is never auto-demoted (cheap early-out, nothing to revoke)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, definitionVersion: 1, autoPublishTrusted: false, leaseOwner: LEASE });
  await createCrawlCandidate({ discoverySourceId: source.id, status: INGESTED, observedInBaseline: true });

  const row = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  const result = await evaluateAndApplyTrustDemotion({ source: row, zeroDiscoveryStreak: 0, now: new Date() });
  assert.equal(result.demoted, false);

  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.lifecycleMode, ACTIVE, "an untrusted source's mode is untouched");
});
