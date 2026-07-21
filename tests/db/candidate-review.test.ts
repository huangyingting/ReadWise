/**
 * Candidate-review persistence integration tests (#1100, Phase 3.1).
 *
 * Engine-agnostic like `lifecycle.test.ts`: runs on SQLite under `npm run
 * test:db`, PostgreSQL in CI, guarded by `enabled` (RUN_DB_INTEGRATION=1). They
 * exercise the REAL guarded review commit (`candidate-review-commit.ts`) + the
 * atomic page commit against the live database and prove the #1100 guarantees:
 *
 *   - AC1: approving the same candidate TWICE creates EXACTLY ONE active ingest
 *     Job (the second approve is an idempotent no-op that enqueues nothing);
 *   - reject records SKIPPED_REVIEW and a subsequent discovery re-observation
 *     NEVER requeues it (the rediscovery guard) — no status change, no Job;
 *   - reactivate is the separate SKIPPED_REVIEW → NEEDS_REVIEW audited action;
 *   - the governing invariant: a candidate already linked to an Article can be
 *     neither approved nor rejected.
 *
 * Candidate-ingest Jobs carry the dedupe key
 * `article-ingest:candidate:<id>:v<version>`, which is NOT swept by the shared
 * `dbit_` PREFIX cleanup, so this file tracks + deletes them (and the real-provider
 * candidate created for the rediscovery test) in a local afterEach.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CrawlCandidateStatus, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { applyCandidateReview } from "@/lib/scraper/incremental/candidate-review-commit";
import { commitDiscoveryPage } from "@/lib/scraper/incremental/page-commit";
import type { DiscoveryPageResult } from "@/lib/scraper/incremental/page-commit";
import { candidateIngestDedupeKey, CANDIDATE_INGEST_PROCESSING_VERSION } from "@/lib/jobs";
import { CandidateDateProvenance } from "@prisma/client";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const { ACTIVE } = DiscoverySourceLifecycleMode;
const { NEEDS_REVIEW, SKIPPED_REVIEW, QUEUED, INGESTED } = CrawlCandidateStatus;
const LEASE = "worker-review-1";
const ORIGINAL_CANDIDATE_INGEST_ENABLED = process.env.CANDIDATE_INGEST_ENABLED;

/** candidate ids whose ingest Jobs must be swept (dedupe key is not PREFIX-scoped). */
const approvedCandidateIds = new Set<string>();
/** real-provider candidate ids (providerKey "undark") created for rediscovery. */
const realProviderCandidateIds = new Set<string>();

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
  const dedupeKeys = [...approvedCandidateIds].map((cid) => candidateIngestDedupeKey(cid, CANDIDATE_INGEST_PROCESSING_VERSION));
  if (dedupeKeys.length > 0) {
    await prisma.job.deleteMany({ where: { dedupeKey: { in: dedupeKeys } } });
  }
  if (realProviderCandidateIds.size > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { id: { in: [...realProviderCandidateIds] } } });
  }
  approvedCandidateIds.clear();
  realProviderCandidateIds.clear();
});

function undarkUrl(token: string): string {
  return `https://undark.org/2024/06/15/${token}-story/`;
}

async function activeIngestJobCount(candidateId: string): Promise<number> {
  return prisma.job.count({ where: { dedupeKey: candidateIngestDedupeKey(candidateId, CANDIDATE_INGEST_PROCESSING_VERSION) } });
}

// ---------------------------------------------------------------------------
// AC1: approving the same candidate twice creates ONE active ingest Job.
// ---------------------------------------------------------------------------

test("approve does not enqueue an ingest job while CANDIDATE_INGEST_ENABLED is off by default", { skip: !enabled }, async () => {
  delete process.env.CANDIDATE_INGEST_ENABLED;
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const candidate = await createCrawlCandidate({ discoverySourceId: source.id, status: NEEDS_REVIEW });
  approvedCandidateIds.add(candidate.id);

  const outcome = await applyCandidateReview({ candidateId: candidate.id, action: "approve" });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.kind, "applied");
  assert.equal(outcome.ok && outcome.kind === "applied" && outcome.toStatus, QUEUED);
  assert.equal(outcome.ok && outcome.kind === "applied" && outcome.enqueued, false);
  assert.equal(await activeIngestJobCount(candidate.id), 0);
});

test("approve transitions NEEDS_REVIEW → QUEUED and enqueues ONE ingest job", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const candidate = await createCrawlCandidate({ discoverySourceId: source.id, status: NEEDS_REVIEW });
  approvedCandidateIds.add(candidate.id);

  const first = await applyCandidateReview({ candidateId: candidate.id, action: "approve" });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.kind, "applied");
  assert.equal(first.ok && first.kind === "applied" && first.toStatus, QUEUED);
  assert.equal(first.ok && first.kind === "applied" && first.enqueued, true);

  const row = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.equal(row?.status, QUEUED);
  assert.equal(await activeIngestJobCount(candidate.id), 1, "exactly one ingest job after first approve");
});

test("approving twice is idempotent — the second approve is a no-op and adds NO job (AC1)", { skip: !enabled }, async () => {
  enableCandidateIngestForTest();
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const candidate = await createCrawlCandidate({ discoverySourceId: source.id, status: NEEDS_REVIEW });
  approvedCandidateIds.add(candidate.id);

  await applyCandidateReview({ candidateId: candidate.id, action: "approve" });
  const second = await applyCandidateReview({ candidateId: candidate.id, action: "approve" });

  assert.equal(second.ok, true);
  assert.equal(second.ok && second.kind, "noop");
  assert.equal(second.ok && second.kind === "noop" && second.reason, "already-approved");
  assert.equal(await activeIngestJobCount(candidate.id), 1, "still exactly one ingest job after the second approve");
});

// ---------------------------------------------------------------------------
// Reject → SKIPPED_REVIEW → the rediscovery guard never requeues it.
// ---------------------------------------------------------------------------

test("reject transitions NEEDS_REVIEW → SKIPPED_REVIEW, stamps a sanitized reason, enqueues nothing", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const candidate = await createCrawlCandidate({ discoverySourceId: source.id, status: NEEDS_REVIEW });

  const outcome = await applyCandidateReview({ candidateId: candidate.id, action: "reject" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.kind === "applied" && outcome.toStatus, SKIPPED_REVIEW);

  const row = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.equal(row?.status, SKIPPED_REVIEW);
  assert.ok(row?.terminalReason, "a sanitized terminal reason category is recorded");
  assert.doesNotMatch(row?.terminalReason ?? "", /https?:\/\//);
  assert.equal(await activeIngestJobCount(candidate.id), 0, "reject never enqueues ingest work");
});

test("a rejected (SKIPPED_REVIEW) candidate re-seen by discovery is NEVER requeued (rediscovery guard)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    lifecycleMode: ACTIVE,
    leaseOwner: LEASE,
    baselineStartedAt: new Date("2024-01-01T00:00:00.000Z"),
    baselineCompletedAt: new Date("2024-01-02T00:00:00.000Z"),
    watermarkAt: new Date("2024-01-02T00:00:00.000Z"),
  });

  // A candidate whose identity matches a real-provider URL, so a later discovery
  // page classifies it as a KNOWN identity (existing-identity), not new work.
  const url = undarkUrl(id("reject-rediscover").replace(/_/g, "-"));
  const identity = deriveProvisionalIdentity(url);
  assert.ok(identity.providerKey, "url derives a real provider key");
  const candidate = await createCrawlCandidate({
    discoverySourceId: source.id,
    providerKey: identity.providerKey ?? "undark",
    identityVersion: 1,
    provisionalKey: identity.key,
    status: NEEDS_REVIEW,
  });
  realProviderCandidateIds.add(candidate.id);

  // Operator rejects it.
  await applyCandidateReview({ candidateId: candidate.id, action: "reject" });

  // A normal ACTIVE discovery page re-observes the very same identity.
  const page: DiscoveryPageResult = {
    items: [{ url, publishedAt: new Date("2024-06-15T00:00:00.000Z"), dateProvenance: CandidateDateProvenance.FEED }],
    continuation: { cursor: "next", page: 2 },
    boundaryReached: false,
  };
  const commit = await commitDiscoveryPage({
    sourceId: source.id,
    leaseOwner: LEASE,
    definitionVersion: source.definitionVersion,
    windowStart: new Date("2000-01-01T00:00:00.000Z"),
    page,
  });
  assert.equal(commit.committed, true);
  if (!commit.committed) return;
  assert.equal(commit.outcomes["existing-identity"], 1, "the rejected identity is recognized as KNOWN, not new");

  const row = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.equal(row?.status, SKIPPED_REVIEW, "the rejected candidate is NOT resurrected");
  assert.equal(await activeIngestJobCount(candidate.id), 0, "rediscovery never enqueues an ingest job for a rejected candidate");
});

// ---------------------------------------------------------------------------
// Reactivate — the separate SKIPPED_REVIEW → NEEDS_REVIEW audited action.
// ---------------------------------------------------------------------------

test("reactivate returns a rejected candidate to the review queue (SKIPPED_REVIEW → NEEDS_REVIEW)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const candidate = await createCrawlCandidate({ discoverySourceId: source.id, status: SKIPPED_REVIEW, terminalReason: "operator:rejected_review" });

  const outcome = await applyCandidateReview({ candidateId: candidate.id, action: "reactivate" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.kind === "applied" && outcome.toStatus, NEEDS_REVIEW);

  const row = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.equal(row?.status, NEEDS_REVIEW);
  assert.equal(await activeIngestJobCount(candidate.id), 0, "reactivate never enqueues ingest work");
});

// ---------------------------------------------------------------------------
// Governing invariant: an Article-linked candidate can never be reviewed.
// ---------------------------------------------------------------------------

test("a candidate already linked to a public Article cannot be approved or rejected (governing invariant)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({ lifecycleMode: ACTIVE });
  const article = await prisma.article.create({
    data: { id: id("article"), title: "known", content: "already a public article" },
  });
  const candidate = await createCrawlCandidate({
    discoverySourceId: source.id,
    status: NEEDS_REVIEW,
    articleId: article.id,
  });

  const approve = await applyCandidateReview({ candidateId: candidate.id, action: "approve" });
  assert.equal(approve.ok, false);
  assert.equal(!approve.ok && approve.reason === "illegal" && approve.illegal, "has-article");

  const reject = await applyCandidateReview({ candidateId: candidate.id, action: "reject" });
  assert.equal(reject.ok, false);
  assert.equal(!reject.ok && reject.reason === "illegal" && reject.illegal, "has-article");

  const row = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.equal(row?.status, NEEDS_REVIEW, "status is untouched");
  assert.equal(await activeIngestJobCount(candidate.id), 0);
});

test("applyCandidateReview reports not-found for an unknown candidate id", { skip: !enabled }, async () => {
  const outcome = await applyCandidateReview({ candidateId: id("missing"), action: "approve" });
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.reason, "not-found");
});
