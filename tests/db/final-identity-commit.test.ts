/**
 * Trusted-final-identity + prose-fingerprint convergence integration tests
 * (#1092, Phase 2.2).
 *
 * Engine-agnostic like `page-commit.test.ts` / `candidate-ingest-enqueue.test.ts`:
 * runs on SQLite by default under `npm run test:db` and PostgreSQL in CI, guarded
 * by `enabled` (RUN_DB_INTEGRATION=1). Exercises the REAL `applyFinalIdentity`
 * against the live database and proves the Phase 2.2 acceptance criteria:
 *
 *   - AC1: URL variants (AMP / tracking / redirect / canonical) that resolve to
 *     ONE canonical identity converge on a SINGLE winning candidate — sequential
 *     AND concurrent — with at most one Article-creation path.
 *   - AC2: an unknown cross-domain canonical AND a cross-provider prose
 *     fingerprint each stop BEFORE Article creation with an auditable
 *     CanonicalConflict + NEEDS_REVIEW status.
 *   - AC3: a merged loser retains its aliases + observations (re-pointed to the
 *     winner) while its pending ARTICLE_INGEST job is cancelled.
 *   - AC4: a KNOWN Article (or baseline) candidate is never touched, and a fresh
 *     candidate that collides with a known Article folds INTO it (governing
 *     invariant — an identity check never refreshes a known Article).
 *
 * Candidates carry REAL provider keys ("undark" / "theconversation") so the
 * shared PREFIX sweep cannot reach them; a local afterEach deletes the exact
 * candidates/conflicts/articles/jobs produced here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { CrawlCandidateStatus, JobStatus, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/lib/jobs";
import {
  buildCandidateIngestPayload,
  candidateIngestDedupeKey,
  CANDIDATE_INGEST_PROCESSING_VERSION,
} from "@/lib/jobs/candidate-ingest";
import { applyFinalIdentity } from "@/lib/scraper/incremental/final-identity-commit";
import { deriveCanonicalIdentity } from "@/lib/scraper/url-identity";
import { computeProseFingerprint } from "@/lib/scraper/incremental/prose-fingerprint";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import {
  createCrawlCandidate,
  createDiscoverySource,
  createDiscoveryObservation,
  createUrlAlias,
} from "./support/discovery-fixtures";

registerIntegrationCleanup();

// Rows written under REAL provider keys — the shared PREFIX sweep can't reach
// them, so we track + delete them locally.
const candidateIds = new Set<string>();
const conflictKeys = new Set<string>();
const articleIds = new Set<string>();

function trackCandidate(id: string): string {
  candidateIds.add(id);
  return id;
}

afterEach(async () => {
  if (!enabled) return;
  const ids = [...candidateIds];
  if (ids.length > 0) {
    const dedupePrefixes = ids.map((id) => `article-ingest:candidate:${id}:`);
    for (const prefix of dedupePrefixes) {
      await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: prefix } } });
    }
    await prisma.canonicalConflict.deleteMany({
      where: { incumbentCandidateId: { in: ids } },
    });
  }
  if (conflictKeys.size > 0) {
    await prisma.canonicalConflict.deleteMany({
      where: { canonicalKey: { in: [...conflictKeys] } },
    });
  }
  // Deleting candidates cascades their aliases + candidate-scoped observations
  // and SetNull's any remaining conflict incumbent + articleId link.
  if (ids.length > 0) {
    await prisma.crawlCandidate.deleteMany({ where: { id: { in: ids } } });
  }
  if (articleIds.size > 0) {
    await prisma.article.deleteMany({ where: { id: { in: [...articleIds] } } });
  }
  candidateIds.clear();
  conflictKeys.clear();
  articleIds.clear();
});

const UNDARK = "undark";
const CONVERSATION = "theconversation";

/** A unique admissible undark canonical URL for this run. */
function undarkCanonical(token: string): string {
  return `https://undark.org/2024/06/15/${token}-canon/`;
}

async function mkCandidate(opts: {
  provider: string;
  token: string;
  firstObservedAt?: Date;
  observedInBaseline?: boolean;
  articleId?: string;
  status?: CrawlCandidateStatus;
  bodyFingerprint?: string;
  bodyFingerprintVersion?: number;
}) {
  const now = new Date();
  const c = await createCrawlCandidate({
    providerKey: opts.provider,
    provisionalKey: `v1:${opts.provider}:${opts.token}:${randomUUID()}`,
    firstObservedAt: opts.firstObservedAt ?? now,
    ...(opts.observedInBaseline != null ? { observedInBaseline: opts.observedInBaseline } : {}),
    ...(opts.articleId ? { articleId: opts.articleId } : {}),
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.bodyFingerprint ? { bodyFingerprint: opts.bodyFingerprint } : {}),
    ...(opts.bodyFingerprintVersion != null
      ? { bodyFingerprintVersion: opts.bodyFingerprintVersion }
      : {}),
  });
  trackCandidate(c.id);
  return c;
}

async function enqueueIngest(candidateId: string) {
  return enqueueJob(JobType.ARTICLE_INGEST, buildCandidateIngestPayload(candidateId), {
    dedupeKey: candidateIngestDedupeKey(candidateId, CANDIDATE_INGEST_PROCESSING_VERSION),
  });
}

async function ingestJobStatus(candidateId: string): Promise<JobStatus | null> {
  const job = await prisma.job.findUnique({
    where: { dedupeKey: candidateIngestDedupeKey(candidateId, CANDIDATE_INGEST_PROCESSING_VERSION) },
    select: { status: true },
  });
  return job?.status ?? null;
}

// ---------------------------------------------------------------------------
// AC1 — canonical convergence (sequential)
// ---------------------------------------------------------------------------

test("AC1 sequential: two URL variants converge on one winning candidate", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const canonical = undarkCanonical(token);
  const canonicalKey = deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key;
  conflictKeys.add(canonicalKey);

  const early = new Date("2026-01-01T00:00:00Z");
  const late = new Date("2026-02-01T00:00:00Z");
  const c1 = await mkCandidate({ provider: UNDARK, token, firstObservedAt: early });
  const c2 = await mkCandidate({ provider: UNDARK, token, firstObservedAt: late });
  await enqueueIngest(c1.id);
  await enqueueIngest(c2.id);

  const r1 = await applyFinalIdentity({
    candidateId: c1.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/amp/2024/06/15/${token}-canon/`,
    canonicalUrl: canonical,
  });
  assert.equal(r1.action, "kept");

  const r2 = await applyFinalIdentity({
    candidateId: c2.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-canon/?utm_source=tw`,
    canonicalUrl: canonical,
  });
  assert.equal(r2.action, "kept");
  assert.equal(r2.action === "kept" && r2.winnerId, c1.id);
  assert.deepEqual(r2.action === "kept" && r2.mergedLoserIds, [c2.id]);

  // Exactly ONE candidate holds the canonical identity slot.
  const holders = await prisma.crawlCandidate.findMany({
    where: { providerKey: UNDARK, canonicalKey },
    select: { id: true },
  });
  assert.equal(holders.length, 1);
  assert.equal(holders[0].id, c1.id);

  const loser = await prisma.crawlCandidate.findUnique({ where: { id: c2.id } });
  assert.equal(loser?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(loser?.canonicalKey, null);
});

// ---------------------------------------------------------------------------
// AC1 — canonical convergence (CONCURRENT) + convergence-after-conflict
// ---------------------------------------------------------------------------

test("AC1 concurrent: racing resolutions converge on one winner (never both fail)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const canonical = undarkCanonical(token);
  const canonicalKey = deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key;
  conflictKeys.add(canonicalKey);

  const early = new Date("2026-01-01T00:00:00Z");
  const late = new Date("2026-03-01T00:00:00Z");
  const winner = await mkCandidate({ provider: UNDARK, token, firstObservedAt: early });
  const other = await mkCandidate({ provider: UNDARK, token, firstObservedAt: late });
  await enqueueIngest(winner.id);
  await enqueueIngest(other.id);

  const apply = (id: string, variant: string) =>
    applyFinalIdentity({
      candidateId: id,
      owningProviderKey: UNDARK,
      finalUrl: `https://undark.org/2024/06/15/${token}-${variant}/`,
      canonicalUrl: canonical,
    });

  // Both resolve to the SAME canonical concurrently.
  const results = await Promise.all([apply(winner.id, "a"), apply(other.id, "b")]);
  for (const r of results) {
    assert.ok(r.action === "kept", `expected kept, got ${r.action}`);
  }

  const holders = await prisma.crawlCandidate.findMany({
    where: { providerKey: UNDARK, canonicalKey },
    select: { id: true },
  });
  assert.equal(holders.length, 1, "exactly one candidate holds the canonical slot");
  assert.equal(holders[0].id, winner.id, "earliest candidate wins");

  const loser = await prisma.crawlCandidate.findUnique({ where: { id: other.id } });
  assert.equal(loser?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(await ingestJobStatus(other.id), JobStatus.DEAD_LETTER);
  assert.notEqual(await ingestJobStatus(winner.id), JobStatus.DEAD_LETTER);
});

// ---------------------------------------------------------------------------
// AC3 — aliases + observations retained (re-pointed); loser job cancelled
// ---------------------------------------------------------------------------

test("AC3: merged loser retains aliases + observations and its ingest job is cancelled", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const canonical = undarkCanonical(token);
  const canonicalKey = deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key;
  conflictKeys.add(canonicalKey);

  const source = await createDiscoverySource();
  const c1 = await mkCandidate({
    provider: UNDARK,
    token,
    firstObservedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const c2 = await mkCandidate({
    provider: UNDARK,
    token,
    firstObservedAt: new Date("2026-02-01T00:00:00Z"),
  });
  const loserAlias = await createUrlAlias(c2.id, UNDARK, {
    aliasKey: `v1:${UNDARK}:${token}:loser:${randomUUID()}`,
  });
  const loserObs = await createDiscoveryObservation(source.id, {
    candidateId: c2.id,
    observationKey: `obs:${token}:${randomUUID()}`,
  });
  await enqueueIngest(c1.id);
  await enqueueIngest(c2.id);

  await applyFinalIdentity({
    candidateId: c1.id,
    owningProviderKey: UNDARK,
    finalUrl: canonical,
    canonicalUrl: canonical,
  });
  await applyFinalIdentity({
    candidateId: c2.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-dup/`,
    canonicalUrl: canonical,
  });

  const alias = await prisma.urlAlias.findUnique({ where: { id: loserAlias.id } });
  assert.equal(alias?.candidateId, c1.id, "loser alias re-pointed to winner (retained)");
  const obs = await prisma.discoveryObservation.findUnique({ where: { id: loserObs.id } });
  assert.equal(obs?.candidateId, c1.id, "loser observation re-pointed to winner (retained)");

  assert.equal(await ingestJobStatus(c2.id), JobStatus.DEAD_LETTER, "loser ingest cancelled");
  assert.notEqual(await ingestJobStatus(c1.id), JobStatus.DEAD_LETTER, "winner ingest untouched");
});

// ---------------------------------------------------------------------------
// AC2 — unknown cross-domain canonical → review
// ---------------------------------------------------------------------------

test("AC2: unknown cross-domain canonical is parked before Article creation", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const c = await mkCandidate({ provider: UNDARK, token });
  await enqueueIngest(c.id);

  const r = await applyFinalIdentity({
    candidateId: c.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-story/`,
    canonicalUrl: `https://random-aggregator.example/story/${token}`,
  });
  assert.equal(r.action, "routed-to-review");
  assert.equal(r.action === "routed-to-review" && r.reason, "unknown-cross-domain-canonical");

  const after = await prisma.crawlCandidate.findUnique({ where: { id: c.id } });
  assert.equal(after?.status, CrawlCandidateStatus.NEEDS_REVIEW);
  assert.equal(await ingestJobStatus(c.id), JobStatus.DEAD_LETTER);

  const conflict = await prisma.canonicalConflict.findFirst({
    where: { providerKey: UNDARK, canonicalKey: c.provisionalKey },
  });
  conflictKeys.add(c.provisionalKey);
  assert.ok(conflict, "auditable conflict row created");
  assert.equal(conflict?.status, "OPEN");
  assert.match(conflict?.reason ?? "", /unknown-cross-domain-canonical/);
});

// ---------------------------------------------------------------------------
// AC2 — cross-provider prose fingerprint → review
// ---------------------------------------------------------------------------

test("AC2: cross-provider prose fingerprint match is parked before Article creation", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const prose = `A distinctive syndicated article body ${token} shared verbatim.`;
  const fp = computeProseFingerprint(prose)!;

  // Pre-existing candidate under a DIFFERENT provider carrying the same fingerprint.
  await mkCandidate({
    provider: CONVERSATION,
    token,
    bodyFingerprint: fp.hash,
    bodyFingerprintVersion: fp.version,
  });

  const canonical = undarkCanonical(token);
  conflictKeys.add(deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key);
  const c = await mkCandidate({ provider: UNDARK, token });
  await enqueueIngest(c.id);

  const r = await applyFinalIdentity({
    candidateId: c.id,
    owningProviderKey: UNDARK,
    finalUrl: canonical,
    canonicalUrl: canonical,
    prose,
  });
  assert.equal(r.action, "routed-to-review");
  assert.equal(r.action === "routed-to-review" && r.reason, "cross-provider-prose-fingerprint");

  const after = await prisma.crawlCandidate.findUnique({ where: { id: c.id } });
  assert.equal(after?.status, CrawlCandidateStatus.NEEDS_REVIEW);
  assert.equal(await ingestJobStatus(c.id), JobStatus.DEAD_LETTER);
});

// ---------------------------------------------------------------------------
// AC2 (positive) — same-provider prose fingerprint merges
// ---------------------------------------------------------------------------

test("same-provider identical prose merges into the earliest winner", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const prose = `Same-provider identical body ${token} appearing twice.`;
  const fp = computeProseFingerprint(prose)!;

  // Earlier same-provider candidate already fingerprinted (a distinct canonical).
  const earlier = await mkCandidate({
    provider: UNDARK,
    token: `${token}early`,
    firstObservedAt: new Date("2026-01-01T00:00:00Z"),
    bodyFingerprint: fp.hash,
    bodyFingerprintVersion: fp.version,
  });
  await enqueueIngest(earlier.id);

  const canonical = undarkCanonical(token);
  conflictKeys.add(deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key);
  const later = await mkCandidate({
    provider: UNDARK,
    token,
    firstObservedAt: new Date("2026-02-01T00:00:00Z"),
  });
  await enqueueIngest(later.id);

  const r = await applyFinalIdentity({
    candidateId: later.id,
    owningProviderKey: UNDARK,
    finalUrl: canonical,
    canonicalUrl: canonical,
    prose,
  });
  assert.equal(r.action, "kept");
  // The later candidate folds into the earlier same-provider duplicate.
  assert.equal(r.action === "kept" && r.winnerId, earlier.id);

  const loser = await prisma.crawlCandidate.findUnique({ where: { id: later.id } });
  assert.equal(loser?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(await ingestJobStatus(later.id), JobStatus.DEAD_LETTER);
});

// ---------------------------------------------------------------------------
// AC4 — a KNOWN identity is never touched
// ---------------------------------------------------------------------------

test("AC4: a baseline (known) candidate is left untouched even if a later fetch differs", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const c = await mkCandidate({
    provider: UNDARK,
    token,
    observedInBaseline: true,
    status: CrawlCandidateStatus.BASELINE,
  });

  const r = await applyFinalIdentity({
    candidateId: c.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-different/`,
    canonicalUrl: undarkCanonical(`${token}-different`),
  });
  assert.equal(r.action, "known-article-untouched");

  const after = await prisma.crawlCandidate.findUnique({ where: { id: c.id } });
  assert.equal(after?.status, CrawlCandidateStatus.BASELINE);
  assert.equal(after?.canonicalKey, null, "no canonical assigned to a known identity");
});

test("AC4: a fresh candidate colliding with a KNOWN Article folds INTO the Article (never refreshed)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const canonical = undarkCanonical(token);
  const canonicalKey = deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key;
  conflictKeys.add(canonicalKey);

  const article = await prisma.article.create({
    data: {
      id: `dbit_article_${randomUUID().replace(/-/g, "")}`,
      title: "Known Article",
      content: "Known Article body.",
    },
  });
  articleIds.add(article.id);

  // Known-Article candidate already holds the canonical identity (fresh, later).
  const known = await mkCandidate({
    provider: UNDARK,
    token,
    articleId: article.id,
    status: CrawlCandidateStatus.INGESTED,
    firstObservedAt: new Date("2026-05-01T00:00:00Z"),
  });
  await prisma.crawlCandidate.update({ where: { id: known.id }, data: { canonicalKey } });

  // A fresh, EARLIER candidate resolves to the same canonical.
  const fresh = await mkCandidate({
    provider: UNDARK,
    token,
    firstObservedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await enqueueIngest(fresh.id);

  const r = await applyFinalIdentity({
    candidateId: fresh.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-fresh/`,
    canonicalUrl: canonical,
  });
  // The known Article wins despite being later-dated; the fresh candidate folds.
  assert.equal(r.action, "kept");
  assert.equal(r.action === "kept" && r.winnerId, known.id);

  const knownAfter = await prisma.crawlCandidate.findUnique({ where: { id: known.id } });
  assert.equal(knownAfter?.articleId, article.id, "known Article link untouched");
  assert.equal(knownAfter?.status, CrawlCandidateStatus.INGESTED, "known Article status untouched");
  assert.equal(knownAfter?.canonicalKey, canonicalKey);

  const freshAfter = await prisma.crawlCandidate.findUnique({ where: { id: fresh.id } });
  assert.equal(freshAfter?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(await ingestJobStatus(fresh.id), JobStatus.DEAD_LETTER);
});

// ---------------------------------------------------------------------------
// Cross-provider ownership transfer
// ---------------------------------------------------------------------------

test("transfer: canonical owned by another registered provider transfers ownership", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  // A valid theconversation article canonical (target provider admission passes).
  const canonical = `https://theconversation.com/${token}-syndicated-story-123456`;
  const canonicalKey = deriveCanonicalIdentity(canonical, { owningProviderKey: UNDARK }).key;
  conflictKeys.add(canonicalKey);

  const c = await mkCandidate({ provider: UNDARK, token });
  await enqueueIngest(c.id);

  const r = await applyFinalIdentity({
    candidateId: c.id,
    owningProviderKey: UNDARK,
    finalUrl: `https://undark.org/2024/06/15/${token}-repost/`,
    canonicalUrl: canonical,
  });
  assert.equal(r.action, "transferred");
  assert.equal(r.action === "transferred" && r.targetProviderKey, CONVERSATION);

  const after = await prisma.crawlCandidate.findUnique({ where: { id: c.id } });
  assert.equal(after?.providerKey, CONVERSATION, "ownership transferred to target provider");
  assert.equal(after?.canonicalKey, canonicalKey);
});
