/**
 * Candidate-based ARTICLE_INGEST enqueue integration tests (#1091, Phase 2.1).
 *
 * Engine-agnostic like `page-commit.test.ts`: runs on SQLite by default under
 * `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL `commitDiscoveryPage` against the
 * live database and proves the Phase 2.1 acceptance criteria:
 *
 *   - AC1: a committed eligible candidate has exactly ONE active ARTICLE_INGEST
 *     job for its processing version, and fault injection that rolls the page
 *     back leaves NO job AND an unadvanced checkpoint (transaction atomicity).
 *   - AC2: replaying / concurrently committing the same page produces NO extra
 *     active job (dedupe idempotency).
 *   - AC3: a TERMINAL job is not reset by ordinary rediscovery (winner reused).
 *   - AC4: the job payload + error history contain no URL / token / article data.
 *   - Only `eligible` candidates in ACTIVE mode enqueue; shadow/baseline do not.
 *
 * Candidates carry the REAL provider key ("undark") derived from each item URL,
 * so the shared PREFIX sweep cannot reach them; a local afterEach deletes the
 * exact identity keys produced here AND the candidate-based ingest jobs keyed on
 * their (cuid) candidate ids.
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
import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  candidateIngestDedupeKey,
} from "@/lib/jobs/candidate-ingest";
import { ACTIVE_STATUSES } from "@/lib/jobs";
import { commitDiscoveryPage } from "@/lib/scraper/incremental/page-commit";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const createdIdentityKeys = new Set<string>();
const ORIGINAL_CANDIDATE_INGEST_ENABLED = process.env.CANDIDATE_INGEST_ENABLED;

function enableCandidateIngestForTest(): void {
  process.env.CANDIDATE_INGEST_ENABLED = "true";
}

function restoreCandidateIngestFlag(): void {
  if (ORIGINAL_CANDIDATE_INGEST_ENABLED === undefined) {
    delete process.env.CANDIDATE_INGEST_ENABLED;
    return;
  }
  process.env.CANDIDATE_INGEST_ENABLED = ORIGINAL_CANDIDATE_INGEST_ENABLED;
}

afterEach(async () => {
  restoreCandidateIngestFlag();
  if (!enabled) return;
  const keys = [...createdIdentityKeys];
  if (keys.length > 0) {
    // Ingest jobs are keyed on the candidate cuid, not the PREFIX, so resolve
    // the candidates first, delete their jobs, then cascade-delete candidates.
    const cands = await prisma.crawlCandidate.findMany({
      where: { provisionalKey: { in: keys } },
      select: { id: true },
    });
    const dedupeKeys = cands.map((c) =>
      candidateIngestDedupeKey(c.id, CANDIDATE_INGEST_PROCESSING_VERSION),
    );
    if (dedupeKeys.length > 0) {
      await prisma.job.deleteMany({ where: { dedupeKey: { in: dedupeKeys } } });
    }
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
    // Unparseable URLs never produce a key.
  }
  return url;
}

const provenance = CandidateDateProvenance.FEED;
const LEASE = "worker-1";

function page(
  items: DiscoveryPageResult["items"],
  continuation: DiscoveryPageResult["continuation"] = { cursor: "next-cursor", page: 2 },
): DiscoveryPageResult {
  return { items, continuation, boundaryReached: false };
}

async function activeSource() {
  return createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner: LEASE,
  });
}

async function ingestJobForUrl(url: string) {
  const identity = deriveProvisionalIdentity(url);
  const candidate = await prisma.crawlCandidate.findFirst({
    where: { provisionalKey: identity.key },
    select: { id: true },
  });
  if (!candidate) return null;
  const dedupeKey = candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION);
  return prisma.job.findUnique({ where: { dedupeKey } });
}

// ---------------------------------------------------------------------------
// AC1 (happy path): an eligible commit enqueues exactly one candidate-based
// ARTICLE_INGEST job, atomically with the candidate + advanced checkpoint.
// ---------------------------------------------------------------------------

test("eligible ACTIVE commit does not enqueue candidate ingest while CANDIDATE_INGEST_ENABLED is off by default", { skip: !enabled }, async () => {
  delete process.env.CANDIDATE_INGEST_ENABLED;
  const source = await activeSource();
  const url = track(undarkUrl(id("disabled")));

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
    runId: "run-disabled",
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes.eligible, 1);
  assert.equal(result.ingestJobsEnqueued, 0);
  const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: deriveProvisionalIdentity(url).key } });
  assert.ok(candidate, "eligible candidate is still recorded");
  assert.equal(await ingestJobForUrl(url), null);
});

test("eligible ACTIVE commit enqueues exactly one candidate-based ingest job (AC1)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("elig")));

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
    runId: "run-1",
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes.eligible, 1);
  assert.equal(result.ingestJobsEnqueued, 1);

  const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: deriveProvisionalIdentity(url).key } });
  assert.ok(candidate);
  const job = await ingestJobForUrl(url);
  assert.ok(job, "an ARTICLE_INGEST job exists for the eligible candidate");
  assert.equal(job.type, JobType.ARTICLE_INGEST);
  assert.equal(job.status, JobStatus.PENDING);
  assert.ok(ACTIVE_STATUSES.includes(job.status));
  assert.equal(job.dedupeKey, candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION));

  // AC4: payload + error history carry NO URL / secret / article data.
  assert.deepEqual(job.payload, {
    candidateId: candidate.id,
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
  assert.deepEqual(job.errorHistory, []);
  const serialized = JSON.stringify(job.payload);
  assert.equal(serialized.includes("undark.org"), false, "no URL in payload");
  assert.equal(serialized.includes("http"), false, "no URL scheme in payload");
});

// ---------------------------------------------------------------------------
// AC1 (fault injection): a fault after the item write rolls the WHOLE page back
// — no candidate, no ingest job, and the checkpoint never advances.
// ---------------------------------------------------------------------------

test("a fault after the eligible item write rolls back the job AND the checkpoint (AC1)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("fault")));
  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  await assert.rejects(() =>
    commitDiscoveryPage({
      sourceId: source.id,
      leaseOwner: LEASE,
      definitionVersion: source.definitionVersion,
      windowStart: new Date("2024-01-01T00:00:00.000Z"),
      page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
      debugHooks: {
        afterItemWrite: () => {
          throw new Error("injected fault after item write");
        },
      },
    }),
  );

  // Rolled back: no candidate, no ingest job, checkpoint unchanged.
  assert.equal(await prisma.crawlCandidate.count({ where: { provisionalKey: deriveProvisionalIdentity(url).key } }), 0);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.checkpointCursor, null, "checkpoint never advanced past a missing job");
  assert.equal(after?.checkpointPage, null);
});

// ---------------------------------------------------------------------------
// AC1 (lost lease mid-commit): the guarded checkpoint advance fails → rollback,
// so the eligible ingest job is never durably created.
// ---------------------------------------------------------------------------

test("a lost lease at the checkpoint advance rolls back the ingest job (AC1)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("lease")));
  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
    debugHooks: {
      // Steal the lease inside the tx, before the guarded checkpoint advance.
      beforeCheckpoint: async (tx) => {
        await tx.discoverySource.update({
          where: { id: source.id },
          data: { leaseOwner: "thief" },
        });
      },
    },
  });

  assert.equal(result.committed, false);
  assert.equal(await prisma.crawlCandidate.count({ where: { provisionalKey: deriveProvisionalIdentity(url).key } }), 0);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
});

// ---------------------------------------------------------------------------
// AC2: replaying the same page enqueues NO additional active job.
// ---------------------------------------------------------------------------

test("replaying the same eligible page adds no extra active ingest job (AC2)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("replay")));
  const args = {
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
  };

  const first = await commitDiscoveryPage(args);
  assert.equal(first.committed && first.ingestJobsEnqueued, 1);
  const jobAfterFirst = await ingestJobForUrl(url);
  assert.ok(jobAfterFirst);

  // Replay the identical page.
  const second = await commitDiscoveryPage(args);
  assert.equal(second.committed, true);

  const candidate = await prisma.crawlCandidate.findFirstOrThrow({ where: { provisionalKey: deriveProvisionalIdentity(url).key } });
  const jobs = await prisma.job.findMany({
    where: { dedupeKey: candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION) },
  });
  assert.equal(jobs.length, 1, "replay converges on a single job");
  assert.equal(jobs[0].id, jobAfterFirst.id, "same job reused across replay");
});

// ---------------------------------------------------------------------------
// AC2 (concurrency): two concurrent commits of the same page converge on ONE job.
// ---------------------------------------------------------------------------

test("concurrent commits of the same page converge on one ingest job (AC2)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("concurrent")));
  const args = {
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
  };

  const [a, b] = await Promise.allSettled([commitDiscoveryPage(args), commitDiscoveryPage(args)]);
  // At least one commit succeeds; a serialization retry on the other engine may
  // reject, which is acceptable — the invariant is a single converged job.
  assert.ok(a.status === "fulfilled" || b.status === "fulfilled");

  const candidate = await prisma.crawlCandidate.findFirstOrThrow({ where: { provisionalKey: deriveProvisionalIdentity(url).key } });
  const jobs = await prisma.job.findMany({
    where: { dedupeKey: candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION) },
  });
  assert.equal(jobs.length, 1, "concurrent commits converge on one job");
});

// ---------------------------------------------------------------------------
// AC3: a TERMINAL ingest job is not reset by ordinary rediscovery of the same
// candidate/version — the dedupe winner is reused.
// ---------------------------------------------------------------------------

test("a terminal ingest job is not reset by rediscovery (AC3)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("terminal")));
  const args = {
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
  };

  const first = await commitDiscoveryPage(args);
  assert.equal(first.committed, true);
  const job = await ingestJobForUrl(url);
  assert.ok(job);

  // Drive the job to a terminal COMPLETED state, as a worker would.
  await prisma.job.update({
    where: { id: job.id },
    data: { status: JobStatus.COMPLETED, completedAt: new Date() },
  });

  // Ordinary rediscovery of the same candidate/version.
  const second = await commitDiscoveryPage(args);
  assert.equal(second.committed, true);

  const reloaded = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(reloaded.status, JobStatus.COMPLETED, "terminal job stays COMPLETED, not reset to PENDING");
  assert.equal(reloaded.attempts, 0);
});

// ---------------------------------------------------------------------------
// Gating: shadow-mode (non-ACTIVE) commits observe the candidate but enqueue
// NO ingest job.
// ---------------------------------------------------------------------------

test("shadow-mode commit observes the candidate but enqueues NO ingest job", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.SHADOW,
    leaseOwner: LEASE,
  });
  const url = track(undarkUrl(id("shadow")));
  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 }]),
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes.eligible, 0, "shadow mode never yields eligible");
  assert.equal(result.ingestJobsEnqueued, 0);

  const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: deriveProvisionalIdentity(url).key } });
  assert.ok(candidate, "shadow candidate is still observed");
  assert.equal(candidate.status, CrawlCandidateStatus.DISCOVERED);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
});
