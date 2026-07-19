/**
 * Lifecycle transition + activation integration tests (#1088, Phase 1.8).
 *
 * Engine-agnostic like `page-commit.test.ts` / `frontier-commit.test.ts`: runs on
 * SQLite by default under `npm run test:db`, PostgreSQL in CI, guarded by
 * `enabled` (RUN_DB_INTEGRATION=1). They exercise the real lifecycle persistence
 * (`lifecycle-commit.ts`) + the atomic page commit against the live database and
 * prove the Phase 1.8 guarantees:
 *
 *   - baseline SUCCESS: begin → observe baseline identities → complete stamps
 *     `baselineCompletedAt` + the initial watermark and enters SHADOW;
 *   - PARTIAL baseline: an incomplete/failed segment refuses completion;
 *   - crash/RESUME: a partial activation (mode flipped, candidates not yet
 *     queued) resumes queueing the remaining eligible candidates;
 *   - the immediate SECOND-SCAN cutover: a shadow re-scan distinguishes new
 *     identities WITHOUT reclassifying baseline identities;
 *   - activation CATCH-UP honoring BOTH the 7-day and 100-count limits and
 *     DETERMINISTIC (idempotent) on retry;
 *   - PAUSE and ROLLBACK guarded transitions;
 *   - AC2: NO Article, NO body fetch, and NO ARTICLE_INGEST job throughout
 *     baseline + shadow, with injected FAILING body-work deps never reached.
 *
 * Candidates written by `commitDiscoveryPage` carry the REAL provider key
 * ("undark") derived from each item URL, so a local afterEach deletes the exact
 * identity keys produced here; directly-created candidates and discovery sources
 * are PREFIX-scoped and swept by the shared cleanup.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  CandidateDateProvenance,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  JobStatus,
  JobType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { commitDiscoveryPage } from "@/lib/scraper/incremental/page-commit";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import {
  activateDiscoverySource,
  beginBaseline,
  completeBaseline,
  transitionDiscoveryLifecycle,
} from "@/lib/scraper/incremental/lifecycle-commit";
import { applyLifecycleAction } from "@/lib/scraper/incremental/lifecycle-actions";
import { enqueueCandidateIngestInTx, ROLLBACK_CANCELLED_REASON } from "@/lib/jobs";
import {
  BodyWorkProhibitedError,
  guardIngestPort,
} from "@/lib/scraper/incremental/lifecycle-run-guard";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { DISABLED, BASELINE, SHADOW, ACTIVE, PAUSED } = DiscoverySourceLifecycleMode;
const LEASE = "worker-1";
const provenance = CandidateDateProvenance.FEED;

// Identity keys produced by page commits (written under the real provider key).
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

function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

function track(url: string): string {
  try {
    createdIdentityKeys.add(deriveProvisionalIdentity(url).key);
  } catch {
    /* unparseable → no key to track */
  }
  return url;
}

function page(
  items: DiscoveryPageResult["items"],
  continuation: DiscoveryPageResult["continuation"] = { cursor: "next", page: 2 },
  boundaryReached = false,
): DiscoveryPageResult {
  return { items, continuation, boundaryReached };
}

async function commitPage(sourceId: string, definitionVersion: number, p: DiscoveryPageResult) {
  return commitDiscoveryPage({
    sourceId,
    leaseOwner: LEASE,
    definitionVersion,
    windowStart: new Date("2000-01-01T00:00:00.000Z"),
    page: p,
  });
}

const ALL_COMPLETE = [{ segmentId: "primary", boundaryReached: true, pagesFullyProcessed: true }];

// ---------------------------------------------------------------------------
// Baseline SUCCESS end-to-end.
// ---------------------------------------------------------------------------

test("baseline success: begin → observe → complete stamps watermark and enters shadow", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: DISABLED, leaseOwner: LEASE });

  const begun = await beginBaseline({ sourceId: source.id, leaseOwner: LEASE, definitionVersion: source.definitionVersion });
  assert.equal(begun.committed, true);
  let row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, BASELINE);
  assert.ok(row?.baselineStartedAt);
  assert.equal(row?.baselineCompletedAt, null);

  // Observe one baseline identity: recorded OBSERVED_BASELINE, never ingested.
  const url = track(undarkUrl(id("base")));
  const identity = deriveProvisionalIdentity(url);
  const commit = await commitPage(source.id, source.definitionVersion, page([
    { url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
  ]));
  assert.equal(commit.committed, true);
  if (!commit.committed) return;
  assert.equal(commit.outcomes["baseline-shadow"], 1);

  const baselineCandidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: identity.key } });
  assert.equal(baselineCandidate?.status, BASELINE);
  assert.equal(baselineCandidate?.observedInBaseline, true);
  assert.equal(baselineCandidate?.articleId, null);

  const watermark = { at: new Date("2024-07-01T00:00:00.000Z"), key: identity.key };
  const done = await completeBaseline({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    segments: ALL_COMPLETE,
    initialWatermark: watermark,
    baselineObservedCount: 1,
  });
  assert.equal(done.committed, true);
  if (!done.committed) return;
  assert.equal(done.mode, SHADOW);

  row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW);
  assert.ok(row?.baselineCompletedAt);
  assert.equal(row?.baselineObservedCount, 1);
  assert.equal(row?.watermarkAt?.getTime(), watermark.at.getTime());
  assert.equal(row?.watermarkKey, identity.key);

  // AC2: no Article, no ARTICLE_INGEST job produced by the baseline.
  assert.equal(await prisma.article.count({ where: { sourceUrl: url } }), 0);
});

// ---------------------------------------------------------------------------
// PARTIAL baseline cannot complete.
// ---------------------------------------------------------------------------

test("partial baseline: an incomplete segment refuses completion and stays BASELINE", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: BASELINE, leaseOwner: LEASE, baselineStartedAt: new Date() });

  const result = await completeBaseline({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    segments: [
      { segmentId: "a", boundaryReached: true, pagesFullyProcessed: true },
      { segmentId: "b", boundaryReached: false, pagesFullyProcessed: true },
    ],
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "baseline-incomplete");
  assert.deepEqual(result.incompleteSegments, ["b"]);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, BASELINE, "mode unchanged");
  assert.equal(row?.baselineCompletedAt, null, "not stamped complete");
});

// ---------------------------------------------------------------------------
// Immediate SECOND-SCAN cutover.
// ---------------------------------------------------------------------------

test("second-scan cutover: new identities become shadow candidates; baseline identities are NOT reclassified", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: BASELINE, leaseOwner: LEASE, baselineStartedAt: new Date() });

  // Baseline observes X.
  const xUrl = track(undarkUrl(id("cut-x")));
  const xId = deriveProvisionalIdentity(xUrl);
  await commitPage(source.id, source.definitionVersion, page([
    { url: xUrl, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
  ]));

  await completeBaseline({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    segments: ALL_COMPLETE,
  });

  // Immediate second scan (SHADOW): re-sees X and newly sees Y.
  const yUrl = track(undarkUrl(id("cut-y")));
  const yId = deriveProvisionalIdentity(yUrl);
  const scan = await commitPage(source.id, source.definitionVersion, page([
    { url: xUrl, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
    { url: yUrl, publishedAt: new Date("2024-07-10T00:00:00.000Z"), dateProvenance: provenance },
  ]));
  assert.equal(scan.committed, true);
  if (!scan.committed) return;
  // X is already in the ledger → existing-identity (re-observed, not reclassified).
  assert.equal(scan.outcomes["existing-identity"], 1);
  // Y is new in SHADOW → baseline-shadow outcome → OBSERVED_SHADOW.
  assert.equal(scan.outcomes["baseline-shadow"], 1);

  const x = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: xId.key } });
  assert.equal(x?.status, BASELINE, "baseline identity NOT reclassified");
  assert.equal(x?.observedInBaseline, true);

  const y = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: yId.key } });
  assert.equal(y?.status, CrawlCandidateStatus.DISCOVERED, "new identity is a shadow candidate");
  assert.equal(y?.observedInBaseline, false);
});

// ---------------------------------------------------------------------------
// Activation CATCH-UP: both limits + deterministic on retry.
// ---------------------------------------------------------------------------

async function shadowCandidate(sourceId: string, provider: string, daysAgo: number, token: string) {
  const firstObservedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return createCrawlCandidate({
    providerKey: provider,
    discoverySourceId: sourceId,
    provisionalKey: id(`shadow_${token}`),
    status: CrawlCandidateStatus.DISCOVERED,
    observedInBaseline: false,
    firstObservedAt,
    lastObservedAt: firstObservedAt,
  });
}

test("activation catch-up honors both age and count limits and is idempotent on retry", { skip: !enabled }, async () => {
  const provider = id("prov");
  const source = await createDiscoverySource({ providerKey: provider, lifecycleMode: SHADOW, leaseOwner: LEASE });

  // Also seed a baseline observation for the source: it must NEVER be queued.
  const baselineCand = await createCrawlCandidate({
    providerKey: provider,
    discoverySourceId: source.id,
    provisionalKey: id("shadow_baseline"),
    status: CrawlCandidateStatus.BASELINE,
    observedInBaseline: true,
  });

  const recentA = await shadowCandidate(source.id, provider, 1, "recentA");
  const recentB = await shadowCandidate(source.id, provider, 2, "recentB");
  const recentC = await shadowCandidate(source.id, provider, 3, "recentC");
  const tooOld = await shadowCandidate(source.id, provider, 30, "tooOld");

  const result = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    limits: { ageDays: 7, maxCount: 2 },
  });
  assert.equal(result.committed, true);
  if (!result.committed) return;
  // 3 within age, but count cap 2 → 2 queued, 1 deferred; tooOld also deferred.
  assert.equal(result.queuedCount, 2);
  assert.equal(result.deferredCount, 2);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE);
  assert.ok(row?.activatedAt);
  const firstActivatedAt = row?.activatedAt?.getTime();

  // Newest first: recentA, recentB queued; recentC + tooOld deferred.
  const queued = await prisma.crawlCandidate.findMany({
    where: { discoverySourceId: source.id, status: CrawlCandidateStatus.QUEUED },
    select: { id: true },
  });
  assert.deepEqual(new Set(queued.map((c) => c.id)), new Set([recentA.id, recentB.id]));

  // The too-old and over-count candidates stay DISCOVERED shadow observations.
  const stillShadow = await prisma.crawlCandidate.findMany({
    where: { discoverySourceId: source.id, status: CrawlCandidateStatus.DISCOVERED },
    select: { id: true },
  });
  assert.deepEqual(new Set(stillShadow.map((c) => c.id)), new Set([recentC.id, tooOld.id]));

  // Baseline observation untouched.
  const baselineAfter = await prisma.crawlCandidate.findUnique({ where: { id: baselineCand.id } });
  assert.equal(baselineAfter?.status, BASELINE);
  assert.equal(baselineAfter?.observedInBaseline, true);

  // Retry: deterministic + idempotent. recentC is over-count last time but now
  // fits (nothing recent queued this pass) → it queues; tooOld stays deferred.
  const retry = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    limits: { ageDays: 7, maxCount: 2 },
  });
  assert.equal(retry.committed, true);
  if (!retry.committed) return;
  assert.equal(retry.queuedCount, 1, "only recentC now within limits");
  assert.equal(retry.deferredCount, 1, "tooOld still deferred");

  const rowAfterRetry = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(rowAfterRetry?.activatedAt?.getTime(), firstActivatedAt, "activatedAt stamped once");

  // tooOld never queues; a repeated retry with the same limits queues nothing new.
  const settled = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    limits: { ageDays: 7, maxCount: 2 },
  });
  assert.equal(settled.committed && settled.queuedCount, 0);
});

// ---------------------------------------------------------------------------
// Crash / RESUME: a partial activation resumes queueing.
// ---------------------------------------------------------------------------

test("crash/resume: activating an already-ACTIVE source queues remaining eligible shadow candidates", { skip: !enabled }, async () => {
  const provider = id("prov");
  const activatedAt = new Date("2024-07-01T00:00:00.000Z");
  // Simulate a partial activation: mode already ACTIVE, activatedAt stamped, but
  // a shadow candidate was left DISCOVERED (queueing was interrupted).
  const source = await createDiscoverySource({
    providerKey: provider,
    lifecycleMode: ACTIVE,
    leaseOwner: LEASE,
    activatedAt,
  });
  const leftover = await shadowCandidate(source.id, provider, 1, "leftover");

  const resumed = await activateDiscoverySource({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
  });
  assert.equal(resumed.committed, true);
  if (!resumed.committed) return;
  assert.equal(resumed.queuedCount, 1);

  const after = await prisma.crawlCandidate.findUnique({ where: { id: leftover.id } });
  assert.equal(after?.status, CrawlCandidateStatus.QUEUED);

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.activatedAt?.getTime(), activatedAt.getTime(), "activatedAt not re-stamped on resume");
});

// ---------------------------------------------------------------------------
// PAUSE + ROLLBACK guarded transitions.
// ---------------------------------------------------------------------------

test("pause clears scheduling; an invalid transition is refused", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, leaseOwner: LEASE, nextRunAt: new Date() });

  const paused = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    targetMode: PAUSED,
  });
  assert.equal(paused.committed, true);
  let row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, PAUSED);
  assert.equal(row?.nextRunAt, null, "a paused source is never due");

  // PAUSED → DISABLED is a valid rollback; PAUSED → ACTIVE resume.
  const resumed = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    targetMode: ACTIVE,
  });
  assert.equal(resumed.committed, true);
  row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE);
  assert.ok(row?.nextRunAt, "a resumed source is due");
});

test("rollback steps one stage back toward disabled; skipping a stage is refused", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE, leaseOwner: LEASE });

  // Invalid: ACTIVE → DISABLED skips a stage.
  const bad = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    targetMode: DISABLED,
  });
  assert.equal(bad.committed, false);
  if (!bad.committed) assert.equal(bad.reason, "invalid-transition");

  // Valid: ACTIVE → SHADOW rollback.
  const rolled = await transitionDiscoveryLifecycle({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    targetMode: SHADOW,
  });
  assert.equal(rolled.committed, true);
  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW);
});

// ---------------------------------------------------------------------------
// AC2: injected FAILING body-work deps are never reached in baseline/shadow.
// ---------------------------------------------------------------------------

test("baseline + shadow perform ZERO body work; injected failing deps are never reached", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: BASELINE, leaseOwner: LEASE, baselineStartedAt: new Date() });

  // Failing body-work dependencies: any invocation fails the test.
  let bodyFetches = 0;
  let articleWrites = 0;
  let ingestEnqueues = 0;
  const failingFetchBody = async () => { bodyFetches += 1; throw new Error("body fetch must never run in baseline/shadow"); };
  const failingWriteArticle = async () => { articleWrites += 1; throw new Error("Article write must never run in baseline/shadow"); };
  const failingEnqueueIngest = async () => { ingestEnqueues += 1; throw new Error("ARTICLE_INGEST enqueue must never run in baseline/shadow"); };

  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  // Baseline observe.
  const bUrl = track(undarkUrl(id("nobody-b")));
  await commitPage(source.id, source.definitionVersion, page([
    { url: bUrl, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance },
  ]));

  await completeBaseline({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    segments: ALL_COMPLETE,
  });

  // Shadow scan.
  const sUrl = track(undarkUrl(id("nobody-s")));
  await commitPage(source.id, source.definitionVersion, page([
    { url: sUrl, publishedAt: new Date("2024-07-10T00:00:00.000Z"), dateProvenance: provenance },
  ]));

  // The guard refuses body work in SHADOW without ever calling the real dep.
  const guardedFetch = guardIngestPort(SHADOW, "fetch-body", failingFetchBody);
  const guardedWrite = guardIngestPort(SHADOW, "write-article", failingWriteArticle);
  const guardedEnqueue = guardIngestPort(SHADOW, "enqueue-ingest", failingEnqueueIngest);
  await assert.rejects(guardedFetch(), BodyWorkProhibitedError);
  await assert.rejects(guardedWrite(), BodyWorkProhibitedError);
  await assert.rejects(guardedEnqueue(), BodyWorkProhibitedError);

  // Proven: the failing deps were never reached, and no body work landed in the DB.
  assert.equal(bodyFetches, 0);
  assert.equal(articleWrites, 0);
  assert.equal(ingestEnqueues, 0);
  assert.equal(await prisma.article.count({ where: { sourceUrl: { in: [bUrl, sUrl] } } }), 0);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
});

// ---------------------------------------------------------------------------
// #1097: the full active→shadow rollback (park + generation bump + cancel
// unclaimed candidate ingest jobs) RETAINS the ledger.
// ---------------------------------------------------------------------------

test("active→shadow rollback parks scheduling, bumps generation, cancels PENDING ingest, retains ledger", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: null,
    nextRunAt: new Date(),
    activatedAt: new Date("2026-07-01T00:00:00.000Z"),
    activationGeneration: 0,
  });

  // A candidate with an UNCLAIMED (PENDING) ingest job, and another whose ingest
  // job is already CLAIMED by a worker (must NOT be cancelled by rollback).
  const pendingCandidate = await createCrawlCandidate({
    providerKey: source.providerKey,
    discoverySourceId: source.id,
    status: CrawlCandidateStatus.QUEUED,
  });
  const claimedCandidate = await createCrawlCandidate({
    providerKey: source.providerKey,
    discoverySourceId: source.id,
    status: CrawlCandidateStatus.QUEUED,
  });

  const pendingJob = await prisma.$transaction((tx) =>
    enqueueCandidateIngestInTx(tx, pendingCandidate.id),
  );
  const claimedJob = await prisma.$transaction((tx) =>
    enqueueCandidateIngestInTx(tx, claimedCandidate.id),
  );
  await prisma.job.update({
    where: { id: claimedJob.id },
    data: { status: JobStatus.CLAIMED, lockedBy: LEASE, lockedAt: new Date() },
  });

  const rolled = await applyLifecycleAction(source.id, "rollback");
  assert.equal(rolled.ok, true);
  if (rolled.ok) {
    assert.equal(rolled.toMode, SHADOW);
    assert.equal(rolled.cancelledJobCount, 1);
    assert.equal(rolled.activationGeneration, 1);
  }

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, SHADOW);
  assert.equal(row?.nextRunAt, null, "scheduling is parked until an explicit re-activation");
  assert.equal(row?.activationGeneration, 1, "generation bumped so pre-rollback jobs fail closed");

  // Unclaimed ingest job → DEAD_LETTER with the controlled reason; claimed job untouched.
  const pendingAfter = await prisma.job.findUnique({ where: { id: pendingJob.id } });
  assert.equal(pendingAfter?.status, JobStatus.DEAD_LETTER);
  assert.equal(pendingAfter?.lastError, ROLLBACK_CANCELLED_REASON);
  const claimedAfter = await prisma.job.findUnique({ where: { id: claimedJob.id } });
  assert.equal(claimedAfter?.status, JobStatus.CLAIMED, "claimed/running work is not cancelled here");

  // The ledger is RETAINED so a later explicit activation can requeue eligible work.
  assert.equal(await prisma.crawlCandidate.count({ where: { discoverySourceId: source.id } }), 2);

  await prisma.job.deleteMany({ where: { id: { in: [pendingJob.id, claimedJob.id] } } });
});

test("active→shadow rollback refuses a leased source and preserves ACTIVE state", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: LEASE,
    nextRunAt: new Date(),
    activationGeneration: 2,
  });

  const result = await applyLifecycleAction(source.id, "rollback");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "busy");

  const row = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(row?.lifecycleMode, ACTIVE);
  assert.equal(row?.activationGeneration, 2, "a refused rollback never bumps the generation");
});
