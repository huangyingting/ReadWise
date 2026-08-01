/**
 * Leased DiscoverySource claim + run integration tests (issue #1087, Phase 1.7).
 *
 * Engine-agnostic like `page-commit.test.ts`: runs on SQLite by default under
 * `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). They exercise the real `claimDueDiscoverySource`
 * adapters and `runClaimedDiscoverySource` against the live database and prove
 * the acceptance criteria:
 *
 *   - two workers claim DIFFERENT due sources and never the same source/version;
 *   - a fresh lease cannot be stolen, but a killed worker's EXPIRED lease is
 *     reclaimable and the committed checkpoint is preserved so the run resumes;
 *   - paused (PAUSED lifecycle) / DISABLED / MANUAL sources are NOT claimed;
 *   - SHADOW / BASELINE sources ARE claimed but a run enqueues NO body work
 *     (no Article, no ARTICLE_INGEST job).
 *
 * Candidate rows carry the REAL provider key derived from each item URL, so the
 * shared PREFIX sweep cannot reach them; a local afterEach deletes the exact
 * identity keys produced here. Discovery sources are PREFIX-scoped.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DiscoverySourceLifecycleMode, DiscoveryAutomationPolicy, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  claimDueDiscoverySource,
  DEFAULT_DISCOVERY_LEASE_TTL_MS,
} from "@/lib/scraper/incremental/discovery-claim";
import { runClaimedDiscoverySource } from "@/lib/scraper/incremental/discovery-run";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const createdIdentityKeys = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const keys = [...createdIdentityKeys];
  if (keys.length > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { provisionalKey: { in: keys } } });
    await prisma.urlAlias.deleteMany({ where: { aliasKey: { in: keys } } });
  }
  createdIdentityKeys.clear();
});

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A unique, admissible undark article URL for this run (real provider key). */
function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

function track(url: string): string {
  try {
    createdIdentityKeys.add(deriveProvisionalIdentity(url).key);
  } catch {
    // Unparseable URLs never produce a key; nothing to clean up.
  }
  return url;
}

/** A due, ACTIVE, SCHEDULED source (claimable) unless overridden. */
async function dueSource(overrides = {}) {
  return createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
    nextRunAt: new Date("2026-07-19T08:00:00.000Z"),
    ...overrides,
  });
}

const NOW = new Date("2026-07-19T08:00:00.000Z");

function singleItemPage(url: string, continuation: DiscoveryPageResult["continuation"], boundaryReached: boolean): DiscoveryPageResult {
  return {
    items: [{ url, positionRank: 0 }],
    continuation,
    boundaryReached,
  };
}

// ---------------------------------------------------------------------------
// Concurrency: two workers claim DIFFERENT due sources, never the same one.
// ---------------------------------------------------------------------------

test("two workers claim different due sources and never the same source/version", { skip: !enabled }, async () => {
  const a = await dueSource();
  const b = await dueSource({ sourceKey: "secondary" });

  const [claimA, claimB] = await Promise.all([
    claimDueDiscoverySource("worker-a", { now: NOW }),
    claimDueDiscoverySource("worker-b", { now: NOW }),
  ]);

  assert.ok(claimA, "worker-a should claim a source");
  assert.ok(claimB, "worker-b should claim a source");
  assert.notEqual(claimA.source.id, claimB.source.id, "two workers must not claim the same source");
  assert.deepEqual([claimA.source.id, claimB.source.id].sort(), [a.id, b.id].sort());
  assert.equal(claimA.source.leaseOwner, "worker-a");
  assert.equal(claimB.source.leaseOwner, "worker-b");

  // Both are now leased: a third worker finds nothing due.
  const none = await claimDueDiscoverySource("worker-c", { now: NOW });
  assert.equal(none, null);
});

// ---------------------------------------------------------------------------
// Stale-lease recovery: a fresh lease can't be stolen; an expired one can, and
// the committed checkpoint is preserved so the run resumes.
// ---------------------------------------------------------------------------

test("a fresh lease cannot be stolen but an expired lease is reclaimable, preserving the checkpoint", { skip: !enabled }, async () => {
  const source = await dueSource({
    leaseOwner: "dead-worker",
    leaseAcquiredAt: new Date(NOW.getTime() - DEFAULT_DISCOVERY_LEASE_TTL_MS - 60_000),
    leaseExpiresAt: new Date(NOW.getTime() - 60_000), // already expired
    checkpointCursor: "page-5",
    checkpointPage: 5,
  });

  // Before the lease expires (evaluate "now" earlier than leaseExpiresAt): no steal.
  const tooEarly = await claimDueDiscoverySource("worker-live", {
    now: new Date(NOW.getTime() - 120_000),
  });
  assert.equal(tooEarly, null, "a still-valid lease must not be reclaimable");

  // After expiry: the stale lease is reclaimable.
  const reclaimed = await claimDueDiscoverySource("worker-live", { now: NOW });
  assert.ok(reclaimed, "an expired lease must be reclaimable");
  assert.equal(reclaimed.source.id, source.id);
  assert.equal(reclaimed.source.leaseOwner, "worker-live");
  assert.equal(reclaimed.wasStale, true, "reclaim of an expired lease must report wasStale");

  // The committed checkpoint survives the reclaim so a resumed run continues from it.
  assert.equal(reclaimed.source.checkpointCursor, "page-5");
  assert.equal(reclaimed.source.checkpointPage, 5);
});

// ---------------------------------------------------------------------------
// Not-claimed states: paused (PAUSED lifecycle), DISABLED, and MANUAL policy.
// ---------------------------------------------------------------------------

test("paused, disabled, and MANUAL sources are not claimed; a future nextRunAt is not due", { skip: !enabled }, async () => {
  await dueSource({ lifecycleMode: DiscoverySourceLifecycleMode.PAUSED, sourceKey: "paused" });
  await dueSource({ lifecycleMode: DiscoverySourceLifecycleMode.DISABLED, sourceKey: "disabled" });
  await dueSource({ automationPolicy: DiscoveryAutomationPolicy.MANUAL, sourceKey: "manual" });
  await dueSource({ sourceKey: "future", nextRunAt: new Date(NOW.getTime() + 3_600_000) });
  await dueSource({ sourceKey: "backoff", backoffUntil: new Date(NOW.getTime() + 3_600_000) });

  const claim = await claimDueDiscoverySource("worker-a", { now: NOW });
  assert.equal(claim, null, "no paused/disabled/manual/not-due source may be claimed");
});

// ---------------------------------------------------------------------------
// Shadow/baseline: claimed and run, but NO body work is enqueued.
// ---------------------------------------------------------------------------

for (const mode of [DiscoverySourceLifecycleMode.SHADOW, DiscoverySourceLifecycleMode.BASELINE] as const) {
  test(`${mode} source is claimed and run but enqueues no body work`, { skip: !enabled }, async () => {
    const source = await dueSource({ lifecycleMode: mode, sourceKey: `body-${mode}` });
    const url = track(undarkUrl(id(`shadow-${mode}`)));

    const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

    const claim = await claimDueDiscoverySource("worker-a", { now: NOW });
    assert.ok(claim);
    assert.equal(claim.source.id, source.id);

    const outcome = await runClaimedDiscoverySource(claim, silentLogger, {
      fetchPage: async () => singleItemPage(url, { cursor: "next", page: 2 }, true),
      now: () => NOW,
    });

    assert.equal(outcome.status, "committed");

    // Governing invariant: discovery-only. No Article, no ingest job.
    assert.equal(await prisma.article.count({ where: { sourceUrl: url } }), 0);
    assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);

    // The lease was released and the checkpoint advanced.
    const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
    assert.equal(after?.leaseOwner, null, "lease must be released after a bounded run");
    assert.equal(after?.checkpointCursor, "next");
  });
}

// ---------------------------------------------------------------------------
// End-to-end resume: a bounded run advances the checkpoint and reschedules; a
// non-boundary page becomes immediately due so pagination resumes.
// ---------------------------------------------------------------------------

test("a bounded non-boundary run advances the checkpoint and stays immediately due", { skip: !enabled }, async () => {
  const source = await dueSource({ sourceKey: "resume" });
  const url = track(undarkUrl(id("resume")));

  const claim = await claimDueDiscoverySource("worker-a", { now: NOW });
  assert.ok(claim);

  const outcome = await runClaimedDiscoverySource(claim, silentLogger, {
    fetchPage: async () => singleItemPage(url, { cursor: "page-2", page: 2 }, false),
    now: () => NOW,
  });

  assert.equal(outcome.status, "committed");
  assert.equal(outcome.boundaryReached, false);
  assert.equal(outcome.caughtUp, false);

  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.checkpointCursor, "page-2", "checkpoint must advance for the next page");
  assert.equal(after?.leaseOwner, null, "lease released so another worker can resume");
  assert.equal(after?.nextRunAt?.getTime(), NOW.getTime(), "more pages remain: immediately due");
  assert.equal(after?.backoffLevel, 0);
  assert.equal(after?.consecutiveFailures, 0);
});

// ---------------------------------------------------------------------------
// Failure isolation: a failing fetch escalates backoff + records a redacted
// error and releases the lease, without throwing.
// ---------------------------------------------------------------------------

test("a failing run escalates backoff, records a redacted error, and releases the lease", { skip: !enabled }, async () => {
  const source = await dueSource({ sourceKey: "failing" });

  const claim = await claimDueDiscoverySource("worker-a", { now: NOW });
  assert.ok(claim);

  const outcome = await runClaimedDiscoverySource(claim, silentLogger, {
    fetchPage: async () => {
      throw new Error("provider exploded at https://undark.org/secret?token=abc123");
    },
    now: () => NOW,
  });

  assert.equal(outcome.status, "failed");

  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.leaseOwner, null, "lease must be released even on failure");
  assert.equal(after?.backoffLevel, 1);
  assert.equal(after?.consecutiveFailures, 1);
  assert.ok(after?.backoffUntil && after.backoffUntil.getTime() > NOW.getTime());
  assert.equal(after?.lastError, "discovery_source_failed");
});
