/**
 * Reconciler integration tests for stamped-but-unclaimed derived regeneration
 * (#1132 — force-rescrape #1103 follow-up).
 *
 * Engine-agnostic like `force-rescrape.test.ts`: runs on SQLite by default under
 * `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL `reconcileUnclaimedRescrapeRegen` /
 * `countUnclaimedRescrapeRegen` against the live database and proves:
 *
 *   - a stamped-but-unclaimed ACTIVE version is re-driven: the per-version claim
 *     step is created (status "generated") and exactly one AI_REBUILD job lands;
 *   - an already-claimed version (step present, status running OR generated) is a
 *     no-op — never re-driven, no duplicate job;
 *   - the governing invariant: a version with `derivedRegenerationRequestedAt ==
 *     null` (ordinary discovery) is NEVER touched;
 *   - idempotency: running the reconciler twice enqueues exactly one rebuild;
 *   - convergence: a second claim of the same version is `alreadyRequested`
 *     (the `@@unique([articleId, step])` constraint guarantees one job);
 *   - the grace window skips a just-stamped version and re-drives it once past it.
 *
 * All Articles/versions use the shared PREFIX so the cascade cleanup sweeps them
 * (deleting the Article cascades its content versions + processing steps). The
 * regeneration jobs are keyed `rescrape-regen:<articleId>:<versionId>`, which
 * CONTAINS but does not START WITH the prefix, so the shared sweep misses them —
 * a local `afterEach` deletes those. Fixture content lives only on the version
 * rows and is never logged.
 */
import assert from "node:assert/strict";

import { afterEach, test } from "node:test";

import { ArticleContentVersionStatus, JobType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  requestDerivedRegeneration,
  rescrapeRegenDedupeKey,
  rescrapeRegenStepKey,
} from "@/lib/scraper/incremental/derived-regeneration";
import {
  countUnclaimedRescrapeRegen,
  reconcileUnclaimedRescrapeRegen,
} from "@/lib/scraper/incremental/rescrape-regen-reconcile";

import { enabled, PREFIX } from "./support/db-config";
import { registerIntegrationCleanup, id } from "./support/db-helpers";

registerIntegrationCleanup();

afterEach(async () => {
  if (!enabled) return;
  // Rebuild jobs are keyed by the prefixed ids but the dedupeKey starts with
  // "rescrape-regen:", so the shared PREFIX sweep misses them — delete here.
  await prisma.job.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A stamp 5 minutes in the past — safely beyond the reconciler's grace window. */
function stampedPast(): Date {
  return new Date(Date.now() - 5 * 60 * 1000);
}

async function createArticle(): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Original Title",
      content: "Original readable body.",
      excerpt: "Original excerpt.",
      sourceUrl: `https://example.com/${articleId}`,
      canonicalUrl: `https://example.com/${articleId}`,
      wordCount: 42,
      readingMinutes: 1,
    },
  });
  return articleId;
}

/** Creates the single ACTIVE content version for `articleId`, optionally stamped. */
async function createActiveVersion(articleId: string, stampedAt: Date | null): Promise<string> {
  const versionId = id("version");
  await prisma.articleContentVersion.create({
    data: {
      id: versionId,
      articleId,
      status: ArticleContentVersionStatus.ACTIVE,
      activeForArticleId: articleId,
      reason: "reconcile test fixture",
      content: "Replacement readable body.",
      title: "Refreshed Title",
      activatedAt: stampedAt ?? new Date(),
      derivedRegenerationRequestedAt: stampedAt,
    },
  });
  return versionId;
}

/** Pre-creates the per-version claim step in a given status (simulates a prior run). */
async function createClaimStep(articleId: string, versionId: string, status: string): Promise<void> {
  await prisma.articleProcessingStep.create({
    data: {
      articleId,
      step: rescrapeRegenStepKey(versionId),
      status,
      attempts: 1,
      startedAt: new Date(),
    },
  });
}

function rebuildJobCount(articleId: string, versionId: string): Promise<number> {
  return prisma.job.count({ where: { dedupeKey: rescrapeRegenDedupeKey(articleId, versionId) } });
}

function claimStepCount(versionId: string): Promise<number> {
  return prisma.articleProcessingStep.count({ where: { step: rescrapeRegenStepKey(versionId) } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("re-drives a stamped-but-unclaimed ACTIVE version (claim step + rebuild job)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const versionId = await createActiveVersion(articleId, stampedPast());

  assert.equal(await countUnclaimedRescrapeRegen(), 1);

  const result = await reconcileUnclaimedRescrapeRegen();
  assert.equal(result.scanned, 1);
  assert.equal(result.reDriven, 1);
  assert.equal(result.alreadyClaimed, 0);

  // Claim landed and persists (status generated), and exactly one rebuild enqueued.
  const step = await prisma.articleProcessingStep.findFirstOrThrow({
    where: { step: rescrapeRegenStepKey(versionId) },
  });
  assert.equal(step.status, "generated");
  const jobs = await prisma.job.findMany({
    where: { dedupeKey: rescrapeRegenDedupeKey(articleId, versionId) },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.type, JobType.AI_REBUILD);

  // Backlog cleared: the claim step now exists so it is no longer unclaimed.
  assert.equal(await countUnclaimedRescrapeRegen(), 0);
});

test("skips an already-claimed version (running OR generated) — no duplicate job", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const runningArticle = await createArticle();
  const runningVersion = await createActiveVersion(runningArticle, stampedPast());
  await createClaimStep(runningArticle, runningVersion, "running");

  const doneArticle = await createArticle();
  const doneVersion = await createActiveVersion(doneArticle, stampedPast());
  await createClaimStep(doneArticle, doneVersion, "generated");

  // Both already have a claim step in ANY status → not counted, not re-driven.
  assert.equal(await countUnclaimedRescrapeRegen(), 0);
  const result = await reconcileUnclaimedRescrapeRegen();
  assert.equal(result.scanned, 0);
  assert.equal(result.reDriven, 0);
  assert.equal(result.alreadyClaimed, 0);

  assert.equal(await rebuildJobCount(runningArticle, runningVersion), 0);
  assert.equal(await rebuildJobCount(doneArticle, doneVersion), 0);
  assert.equal(await claimStepCount(runningVersion), 1);
  assert.equal(await claimStepCount(doneVersion), 1);
});

test("never touches an ordinary version with derivedRegenerationRequestedAt == null", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const versionId = await createActiveVersion(articleId, null);

  assert.equal(await countUnclaimedRescrapeRegen(), 0);
  const result = await reconcileUnclaimedRescrapeRegen();
  assert.equal(result.reDriven, 0);

  assert.equal(await claimStepCount(versionId), 0);
  assert.equal(await rebuildJobCount(articleId, versionId), 0);
});

test("running the reconciler twice enqueues exactly one rebuild", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const versionId = await createActiveVersion(articleId, stampedPast());

  const first = await reconcileUnclaimedRescrapeRegen();
  assert.equal(first.reDriven, 1);

  const second = await reconcileUnclaimedRescrapeRegen();
  assert.equal(second.scanned, 0);
  assert.equal(second.reDriven, 0);

  assert.equal(await rebuildJobCount(articleId, versionId), 1);
  assert.equal(await claimStepCount(versionId), 1);
});

test("two claims converge on exactly one (second re-invoke is alreadyRequested)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const versionId = await createActiveVersion(articleId, stampedPast());

  const first = await requestDerivedRegeneration({ articleId, versionId });
  const second = await requestDerivedRegeneration({ articleId, versionId });

  assert.equal(first.requested, true);
  assert.equal(first.alreadyRequested, false);
  assert.equal(second.requested, false);
  assert.equal(second.alreadyRequested, true);

  assert.equal(await rebuildJobCount(articleId, versionId), 1);
  assert.equal(await claimStepCount(versionId), 1);
});

test("grace window: skips a just-stamped version, re-drives it once past the window", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const stampedAt = new Date("2026-07-20T10:00:00.000Z");
  const articleId = await createArticle();
  const versionId = await createActiveVersion(articleId, stampedAt);

  // 30s after stamping: still inside the 2-minute grace → skipped.
  const inGrace = await reconcileUnclaimedRescrapeRegen({
    now: new Date(stampedAt.getTime() + 30 * 1000),
  });
  assert.equal(inGrace.reDriven, 0);
  assert.equal(await rebuildJobCount(articleId, versionId), 0);
  assert.equal(await claimStepCount(versionId), 0);

  // 5 min after stamping: past the grace window → re-driven exactly once.
  const pastGrace = await reconcileUnclaimedRescrapeRegen({
    now: new Date(stampedAt.getTime() + 5 * 60 * 1000),
  });
  assert.equal(pastGrace.reDriven, 1);
  assert.equal(await rebuildJobCount(articleId, versionId), 1);
  assert.equal(await claimStepCount(versionId), 1);
});
