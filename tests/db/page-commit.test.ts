/**
 * Atomic paged discovery commit integration tests (#1085, Phase 1.5).
 *
 * Engine-agnostic like `discovery-ledger.test.ts` / `baseline-backfill.test.ts`:
 * runs on SQLite by default under `npm run test:db`, PostgreSQL in CI, guarded
 * by `enabled` (RUN_DB_INTEGRATION=1). They exercise the real
 * `commitDiscoveryPage` against the live database and prove the keystone
 * replay-safety guarantees:
 *
 *   - the checkpoint advances ONLY after every item's writes succeed (fault
 *     injection after each write boundary rolls the whole page back);
 *   - two concurrent commits of the SAME page converge on one candidate/alias/
 *     observation set and one checkpoint;
 *   - every item has an idempotent observation + explicit outcome, and a replay
 *     adds no new rows;
 *   - baseline/shadow commits create NO Article and NO ARTICLE_INGEST job;
 *   - a lost lease/version (before OR during the commit) never advances the
 *     checkpoint.
 *
 * Candidate rows carry the REAL provider key ("undark") derived from each item
 * URL, so the shared PREFIX sweep cannot reach them; a local afterEach deletes
 * the exact identity keys produced here. Discovery sources are PREFIX-scoped and
 * swept by the shared cleanup (their source-scoped observations cascade).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  CandidateDateProvenance,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  JobType,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  CANDIDATE_INGEST_PROCESSING_VERSION,
  candidateIngestDedupeKey,
} from "@/lib/jobs/candidate-ingest";
import { commitDiscoveryPage } from "@/lib/scraper/incremental/page-commit";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

// Identity keys produced by this suite. Commit writes them under the real
// provider key, so the shared PREFIX sweep cannot remove the candidates/aliases.
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
    // Candidate-based ingest jobs (#1091) are keyed on the candidate cuid, not
    // the PREFIX, so the shared sweep can't reach them — resolve + delete them
    // before cascade-deleting the candidates.
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
    // Deleting candidates cascades their aliases + candidate-scoped observations.
    await prisma.crawlCandidate.deleteMany({ where: { provisionalKey: { in: keys } } });
    await prisma.urlAlias.deleteMany({ where: { aliasKey: { in: keys } } });
  }
  createdIdentityKeys.clear();
});

/** A unique, admissible undark article URL for this run (real provider key). */
function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

/** Registers the identity key of a URL for cleanup and returns the URL. */
function track(url: string): string {
  try {
    createdIdentityKeys.add(deriveProvisionalIdentity(url).key);
  } catch {
    // Unparseable URLs never produce a key; nothing to clean up.
  }
  return url;
}

const provenance = CandidateDateProvenance.FEED;

function page(
  items: DiscoveryPageResult["items"],
  continuation: DiscoveryPageResult["continuation"] = { cursor: "next-cursor", page: 2 },
): DiscoveryPageResult {
  return { items, continuation, boundaryReached: false };
}

const LEASE = "worker-1";

async function activeSource() {
  return createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner: LEASE,
  });
}

async function countCandidate(url: string): Promise<number> {
  const identity = deriveProvisionalIdentity(url);
  return prisma.crawlCandidate.count({ where: { provisionalKey: identity.key } });
}

// ---------------------------------------------------------------------------
// Happy path: eligible commit writes candidate + alias + observation + advances
// the checkpoint, and creates NO Article.
// ---------------------------------------------------------------------------

test("eligible page commit persists candidate, alias, observation, and checkpoint", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await activeSource();
  const url = track(undarkUrl(id("elig")));
  const identity = deriveProvisionalIdentity(url);
  const publishedAt = new Date("2024-07-01T00:00:00.000Z");

  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-01-01T00:00:00.000Z"),
    page: page([{ url, publishedAt, dateProvenance: provenance, positionRank: 0 }]),
    runId: "run-1",
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes.eligible, 1);
  assert.equal(result.checkpoint.cursor, "next-cursor");
  assert.equal(result.checkpoint.page, 2);

  const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: identity.key } });
  assert.ok(candidate);
  assert.equal(candidate.status, CrawlCandidateStatus.DISCOVERED);
  assert.equal(candidate.observedInBaseline, false);
  assert.equal(candidate.articleId, null);
  assert.equal(candidate.discoverySourceId, source.id);
  assert.equal(candidate.trustedPublishedAt?.getTime(), publishedAt.getTime());
  assert.equal(candidate.dateProvenance, provenance);

  const alias = await prisma.urlAlias.findFirst({ where: { aliasKey: identity.key } });
  assert.ok(alias);
  assert.equal(alias.kind, UrlAliasKind.PROVISIONAL);
  assert.equal(alias.candidateId, candidate.id);

  const observations = await prisma.discoveryObservation.findMany({ where: { discoverySourceId: source.id } });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].observationKey, identity.key);
  assert.equal(observations[0].candidateId, candidate.id);
  assert.equal(observations[0].runId, "run-1");

  const advanced = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(advanced?.checkpointCursor, "next-cursor");
  assert.equal(advanced?.checkpointPage, 2);

  // Phase 2.1 (#1091): with CANDIDATE_INGEST_ENABLED=true, an ELIGIBLE ACTIVE
  // commit enqueues exactly one candidate-based ingest job — but still creates
  // NO Article and does NO body fetch here (fetch/extract/Article creation is #1095).
  assert.equal(result.ingestJobsEnqueued, 1);
  assert.equal(await prisma.article.count({ where: { sourceUrl: url } }), 0);
  const ingestDedupeKey = candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION);
  const ingestJob = await prisma.job.findUnique({ where: { dedupeKey: ingestDedupeKey } });
  assert.ok(ingestJob, "eligible candidate has an ARTICLE_INGEST job");
  assert.equal(ingestJob.type, JobType.ARTICLE_INGEST);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore + 1);
  // AC4: payload carries only the candidate identity — no URL / article data.
  assert.deepEqual(ingestJob.payload, {
    candidateId: candidate.id,
    processingVersion: CANDIDATE_INGEST_PROCESSING_VERSION,
  });
});

// ---------------------------------------------------------------------------
// Every item → idempotent observation + explicit outcome; replay adds no rows.
// ---------------------------------------------------------------------------

test("mixed page: every item is observed with an explicit outcome; replay adds no rows", { skip: !enabled }, async () => {
  const source = await activeSource();
  const eligible = track(undarkUrl(id("mix-elig")));
  const rejected = track("https://undark.org/about/"); // admission-filter reject
  const outside = track(undarkUrl(id("mix-old")));
  const review = track(undarkUrl(id("mix-undated")));

  const pageResult = page([
    { url: eligible, publishedAt: new Date("2024-09-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 0 },
    { url: rejected, positionRank: 1 },
    { url: outside, publishedAt: new Date("2024-01-01T00:00:00.000Z"), dateProvenance: provenance, positionRank: 2 },
    { url: review, positionRank: 3 },
  ]);
  const args = {
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-06-01T00:00:00.000Z"),
    page: pageResult,
  };

  const first = await commitDiscoveryPage(args);
  assert.equal(first.committed, true);
  if (!first.committed) return;
  assert.deepEqual(first.outcomes, {
    "eligible": 1,
    "baseline-shadow": 0,
    "existing-identity": 0,
    "policy-rejected": 1,
    "outside-window": 1,
    "review-required": 1,
  });

  // One observation per distinct item. The eligible item and the (now inert)
  // outside-window item each ensure a candidate (#1127); policy-rejected and
  // review-required still create none.
  const observationsAfterFirst = await prisma.discoveryObservation.count({ where: { discoverySourceId: source.id } });
  assert.equal(observationsAfterFirst, 4);
  const withCandidate = await prisma.discoveryObservation.count({
    where: { discoverySourceId: source.id, candidateId: { not: null } },
  });
  assert.equal(withCandidate, 2);
  assert.equal(await countCandidate(eligible), 1);
  assert.equal(await countCandidate(outside), 1);
  assert.equal(await countCandidate(review), 0);

  // Replay the identical page → no new rows anywhere.
  const second = await commitDiscoveryPage(args);
  assert.equal(second.committed, true);
  assert.equal(await prisma.discoveryObservation.count({ where: { discoverySourceId: source.id } }), 4);
  assert.equal(await prisma.crawlCandidate.count({ where: { discoverySourceId: source.id } }), 2);
  assert.equal(await prisma.urlAlias.count({ where: { candidateId: { in: (await prisma.crawlCandidate.findMany({ where: { discoverySourceId: source.id }, select: { id: true } })).map((c) => c.id) } } }), 2);
});

// ---------------------------------------------------------------------------
// Outside-window (#1127): an ACTIVE-source dated item at/before the window is
// persisted as an INERT SKIPPED_OUTSIDE_WINDOW candidate — no Article, no ingest
// job — and a re-observation never revives it.
// ---------------------------------------------------------------------------

test("outside-window item persists an INERT SKIPPED_OUTSIDE_WINDOW candidate that never auto-enqueues", { skip: !enabled }, async () => {
  const source = await activeSource();
  const url = track(undarkUrl(id("ow")));
  const identity = deriveProvisionalIdentity(url);
  const publishedAt = new Date("2024-01-01T00:00:00.000Z"); // before the window

  const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

  const args = {
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2024-06-01T00:00:00.000Z"),
    page: page([{ url, publishedAt, dateProvenance: provenance, positionRank: 0 }]),
    runId: "run-ow",
  };

  const result = await commitDiscoveryPage(args);
  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes["outside-window"], 1);
  assert.equal(result.outcomes.eligible, 0);
  // Inert: the outside-window branch NEVER enqueues ingest work.
  assert.equal(result.ingestJobsEnqueued, 0);

  const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: identity.key } });
  assert.ok(candidate, "outside-window item persists exactly one candidate");
  assert.equal(candidate.status, CrawlCandidateStatus.SKIPPED_OUTSIDE_WINDOW);
  assert.equal(candidate.observedInBaseline, false);
  assert.equal(candidate.articleId, null);
  assert.equal(candidate.articleDeletedAt, null);
  assert.equal(candidate.discoverySourceId, source.id);
  // trustedPublishedAt is REQUIRED for the later windowed backfill match.
  assert.equal(candidate.trustedPublishedAt?.getTime(), publishedAt.getTime());
  assert.equal(candidate.dateProvenance, provenance);
  assert.equal(candidate.observationCount, 1);

  // A provisional alias is recorded for identity resolution (consistent with
  // other persisted candidates); still NO Article and NO ingest Job.
  const alias = await prisma.urlAlias.findFirst({ where: { aliasKey: identity.key } });
  assert.ok(alias);
  assert.equal(alias.kind, UrlAliasKind.PROVISIONAL);
  assert.equal(alias.candidateId, candidate.id);

  assert.equal(await prisma.article.count({ where: { sourceUrl: url } }), 0);
  const ingestDedupeKey = candidateIngestDedupeKey(candidate.id, CANDIDATE_INGEST_PROCESSING_VERSION);
  assert.equal(await prisma.job.findUnique({ where: { dedupeKey: ingestDedupeKey } }), null);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);

  // Re-observation only bumps lastObservedAt — status/observedInBaseline/articleId
  // are NEVER changed (governing invariant: the inert candidate is never revived).
  const second = await commitDiscoveryPage(args);
  assert.equal(second.committed, true);
  assert.equal(second.ingestJobsEnqueued, 0);
  const after = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: identity.key } });
  assert.ok(after);
  assert.equal(after.id, candidate.id, "no new candidate on re-observation");
  assert.equal(after.status, CrawlCandidateStatus.SKIPPED_OUTSIDE_WINDOW);
  assert.equal(after.observedInBaseline, false);
  assert.equal(after.articleId, null);
  assert.equal(after.observationCount, 1); // update path never bumps the count
  assert.ok(after.lastObservedAt.getTime() >= candidate.lastObservedAt.getTime());
  assert.equal(await prisma.crawlCandidate.count({ where: { provisionalKey: identity.key } }), 1);
  assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
});

// ---------------------------------------------------------------------------
// Concurrent commit of the SAME page converges on one row set + one checkpoint.
// ---------------------------------------------------------------------------

test("two concurrent commits of the same page converge on one candidate/alias/observation", { skip: !enabled }, async () => {
  const source = await activeSource();
  const url = track(undarkUrl(id("race")));
  const args = {
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: source.definitionVersion,
    windowStart: null,
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
  };

  const [a, b] = await Promise.all([commitDiscoveryPage(args), commitDiscoveryPage(args)]);
  assert.equal(a.committed, true);
  assert.equal(b.committed, true);

  assert.equal(await countCandidate(url), 1, "exactly one candidate survives the race");
  assert.equal(await prisma.urlAlias.count({ where: { aliasKey: deriveProvisionalIdentity(url).key } }), 1);
  assert.equal(await prisma.discoveryObservation.count({ where: { discoverySourceId: source.id } }), 1);

  const advanced = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(advanced?.checkpointCursor, "next-cursor");
});

// ---------------------------------------------------------------------------
// Fault injection: a throw after any write boundary rolls the whole page back
// and the checkpoint never advances with a missing candidate outcome.
// ---------------------------------------------------------------------------

test("fault after the first item write rolls back the whole page (no candidate, no checkpoint)", { skip: !enabled }, async () => {
  const source = await activeSource();
  const first = track(undarkUrl(id("fault-a")));
  const secondUrl = track(undarkUrl(id("fault-b")));
  const publishedAt = new Date("2024-07-01T00:00:00.000Z");

  await assert.rejects(
    commitDiscoveryPage({
      sourceId: source.id,
      leaseOwner: source.leaseOwner ?? "",
      definitionVersion: source.definitionVersion,
      windowStart: null,
      page: page([
        { url: first, publishedAt, dateProvenance: provenance },
        { url: secondUrl, publishedAt, dateProvenance: provenance },
      ]),
      debugHooks: {
        afterItemWrite: (index) => {
          if (index === 0) throw new Error("injected fault after first write");
        },
      },
    }),
    /injected fault/,
  );

  assert.equal(await countCandidate(first), 0, "first candidate rolled back");
  assert.equal(await countCandidate(secondUrl), 0, "second item never written");
  assert.equal(await prisma.discoveryObservation.count({ where: { discoverySourceId: source.id } }), 0);
  const unchanged = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(unchanged?.checkpointCursor, null, "checkpoint never advanced");
});

test("fault right before the checkpoint advance rolls back all item writes", { skip: !enabled }, async () => {
  const source = await activeSource();
  const url = track(undarkUrl(id("fault-ckpt")));

  await assert.rejects(
    commitDiscoveryPage({
      sourceId: source.id,
      leaseOwner: source.leaseOwner ?? "",
      definitionVersion: source.definitionVersion,
      windowStart: null,
      page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
      debugHooks: {
        beforeCheckpoint: () => {
          throw new Error("injected fault before checkpoint");
        },
      },
    }),
    /injected fault/,
  );

  assert.equal(await countCandidate(url), 0, "candidate written then rolled back");
  assert.equal(await prisma.discoveryObservation.count({ where: { discoverySourceId: source.id } }), 0);
  const unchanged = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(unchanged?.checkpointCursor, null, "checkpoint never advanced");
});

// ---------------------------------------------------------------------------
// Lease / version validation.
// ---------------------------------------------------------------------------

test("lease lost before commit → no writes, checkpoint unchanged", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner: "worker-A",
  });
  const url = track(undarkUrl(id("lease-pre")));

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: "worker-B", // stolen / lost lease
    definitionVersion: source.definitionVersion,
    windowStart: null,
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "lease-lost");
  assert.equal(await countCandidate(url), 0);
  const unchanged = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(unchanged?.checkpointCursor, null);
});

test("definitionVersion mismatch before commit → lease-lost, no writes", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    definitionVersion: 3,
  });
  const url = track(undarkUrl(id("defver")));

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: 2, // stale definition
    windowStart: null,
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
  });

  assert.equal(result.committed, false);
  if (result.committed) return;
  assert.equal(result.reason, "lease-lost");
  assert.equal(await countCandidate(url), 0);
});

test("lease stolen mid-commit → guarded checkpoint advance aborts and rolls back", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    leaseOwner: "worker-A",
  });
  const url = track(undarkUrl(id("lease-mid")));

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: "worker-A",
    definitionVersion: source.definitionVersion,
    windowStart: null,
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
    debugHooks: {
      // Steal the lease inside the same transaction, right before the guarded
      // checkpoint advance. The advance's WHERE clause no longer matches → the
      // whole transaction (including this steal) rolls back.
      beforeCheckpoint: async (tx) => {
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
  assert.equal(await countCandidate(url), 0, "item writes rolled back");
  const after = await prisma.discoverySource.findUnique({ where: { id: source.id } });
  assert.equal(after?.leaseOwner, "worker-A", "lease steal rolled back with the aborted tx");
  assert.equal(after?.checkpointCursor, null, "checkpoint never advanced");
});

// ---------------------------------------------------------------------------
// Baseline / shadow: candidate is observed, but NO Article and NO ingest job.
// BASELINE mode records OBSERVED_BASELINE (status BASELINE, observedInBaseline);
// SHADOW mode records OBSERVED_SHADOW (status DISCOVERED, a new post-baseline
// candidate) — the #1088 persistence split.
// ---------------------------------------------------------------------------

const BASELINE_SHADOW_CASES = [
  {
    mode: DiscoverySourceLifecycleMode.BASELINE,
    expectedStatus: CrawlCandidateStatus.BASELINE,
    expectedObservedInBaseline: true,
  },
  {
    mode: DiscoverySourceLifecycleMode.SHADOW,
    expectedStatus: CrawlCandidateStatus.DISCOVERED,
    expectedObservedInBaseline: false,
  },
];

for (const { mode, expectedStatus, expectedObservedInBaseline } of BASELINE_SHADOW_CASES) {
  test(`${mode} page commit records an observed candidate but no Article or ingest job`, { skip: !enabled }, async () => {
    const source = await createDiscoverySource({ lifecycleMode: mode, leaseOwner: LEASE });
    const url = track(undarkUrl(id(`base-${mode.toLowerCase()}`)));
    const identity = deriveProvisionalIdentity(url);
    const ingestBefore = await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } });

    const result = await commitDiscoveryPage({
      sourceId: source.id,
      leaseOwner: source.leaseOwner ?? "",
      definitionVersion: source.definitionVersion,
      windowStart: new Date("2000-01-01T00:00:00.000Z"),
      page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
    });

    assert.equal(result.committed, true);
    if (!result.committed) return;
    assert.equal(result.outcomes["baseline-shadow"], 1);

    const candidate = await prisma.crawlCandidate.findFirst({ where: { provisionalKey: identity.key } });
    assert.ok(candidate);
    assert.equal(candidate.status, expectedStatus);
    assert.equal(candidate.observedInBaseline, expectedObservedInBaseline);
    assert.equal(candidate.articleId, null);

    assert.equal(await prisma.article.count({ where: { sourceUrl: url } }), 0);
    assert.equal(await prisma.job.count({ where: { type: JobType.ARTICLE_INGEST } }), ingestBefore);
  });
}

// ---------------------------------------------------------------------------
// Existing identity: re-observed, never re-ingested or revived.
// ---------------------------------------------------------------------------

test("existing identity is re-observed without a new candidate or status change", { skip: !enabled }, async () => {
  const source = await activeSource();
  const url = track(undarkUrl(id("existing")));
  const identity = deriveProvisionalIdentity(url);

  // Seed a pre-existing terminal candidate (as the baseline seed would).
  const seeded = await prisma.crawlCandidate.create({
    data: {
      providerKey: identity.providerKey!,
      identityVersion: 1,
      provisionalKey: identity.key,
      status: CrawlCandidateStatus.INGESTED,
      observedInBaseline: true,
      terminalReason: "baseline-existing-article",
      observationCount: 1,
    },
    select: { id: true, status: true },
  });

  const result = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: source.leaseOwner ?? "",
    definitionVersion: source.definitionVersion,
    windowStart: null,
    page: page([{ url, publishedAt: new Date("2024-07-01T00:00:00.000Z"), dateProvenance: provenance }]),
  });

  assert.equal(result.committed, true);
  if (!result.committed) return;
  assert.equal(result.outcomes["existing-identity"], 1);

  // No new candidate; status/observedInBaseline untouched (never revived).
  assert.equal(await countCandidate(url), 1);
  const after = await prisma.crawlCandidate.findUnique({ where: { id: seeded.id } });
  assert.equal(after?.status, CrawlCandidateStatus.INGESTED);
  assert.equal(after?.observedInBaseline, true);

  // The re-observation is linked to the existing candidate.
  const observation = await prisma.discoveryObservation.findFirst({ where: { discoverySourceId: source.id } });
  assert.equal(observation?.candidateId, seeded.id);
});
