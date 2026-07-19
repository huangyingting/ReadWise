/**
 * Rollback-drill integration test (issue #1098, Phase 2.8, AC3).
 *
 * Proves the AC3 rollout invariant end-to-end: "a rollback drill proves no stale
 * task can write an Article after mode generation changes." This ties together
 * the #1097 active→shadow rollback (`rollbackActiveToShadow`) and the #1095
 * atomic save's activation-generation guard (`saveIncrementalArticle` →
 * `revalidateSourceGeneration`).
 *
 * Engine-agnostic like `article-save-commit.test.ts` / `lifecycle.test.ts`: runs
 * on SQLite by default under `npm run test:db` and PostgreSQL in CI, guarded by
 * `{ skip: !enabled }` (RUN_DB_INTEGRATION=1), so it PASSES/SKIPS on SQLite and
 * never adds a "requires a PostgreSQL DATABASE_URL" failure.
 *
 * The drill:
 *   1. Set up an ACTIVE source at generation N and capture the in-flight task's
 *      generation snapshot; enqueue a PENDING candidate-ingest job and record a
 *      ledger observation.
 *   2. `rollbackActiveToShadow` → source SHADOW at generation N+1; the PENDING
 *      ingest job is DEAD_LETTERed; candidates + observations are preserved.
 *   3. A STALE in-flight task commits a save with the OLD snapshot (generation N)
 *      → REJECTED via the generation guard (no Article written, candidate untouched).
 *   4. Re-activate at generation N+1 and a FRESH task in the correct mode saves
 *      exactly one Article.
 *
 * PRIVACY: candidate reasons/ids are metadata only; the Article legitimately
 * stores product data. Articles/jobs produced by the save carry cuid ids (no
 * PREFIX), so a local afterEach tracks and deletes them; candidates/sources use
 * the PREFIX and are swept by the shared cleanup.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import {
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
  JobStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { articleProcessDedupeKey } from "@/lib/jobs/enqueue";
import { enqueueCandidateIngestInTx, ROLLBACK_CANCELLED_REASON } from "@/lib/jobs";
import {
  saveIncrementalArticle,
  type ArticleDraft,
  type SaveIncrementalArticleInput,
  type SourceGenerationSnapshot,
} from "@/lib/scraper/incremental/article-save-commit";
import { rollbackActiveToShadow } from "@/lib/scraper/incremental/rollback-commit";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import {
  createCrawlCandidate,
  createDiscoveryObservation,
  createDiscoverySource,
} from "./support/discovery-fixtures";

registerIntegrationCleanup();

const ACTIVE = DiscoverySourceLifecycleMode.ACTIVE;
const SHADOW = DiscoverySourceLifecycleMode.SHADOW;
const ACTIVATED_AT = new Date("2026-05-01T00:00:00.000Z");
const DEFINITION_VERSION = 2;
const PROSE = "The quick brown fox jumped over the lazy dog, and then it did so again.";

// Articles/jobs produced by the save carry cuid ids (no PREFIX), so track them.
const articleIds = new Set<string>();
// Candidate-ingest jobs carry a dedupeKey without the PREFIX (it embeds the
// candidate cuid), so the shared sweep cannot reach them — track + delete here.
const jobIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  if (jobIds.size > 0) {
    await prisma.job.deleteMany({ where: { id: { in: [...jobIds] } } });
    jobIds.clear();
  }
  const ids = [...articleIds];
  if (ids.length > 0) {
    await prisma.job.deleteMany({
      where: { dedupeKey: { in: ids.map((id) => articleProcessDedupeKey(id)) } },
    });
    await prisma.crawlCandidate.updateMany({ where: { articleId: { in: ids } }, data: { articleId: null } });
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
  }
  articleIds.clear();
});

function draft(token: string): ArticleDraft {
  return {
    title: `Article ${token}`,
    content: `Body of ${token}. ${PROSE}`,
    source: "Test Provider",
    sourceUrl: `https://example.com/${token}`,
    canonicalUrl: `https://example.com/${token}`,
  };
}

function saveInput(
  candidateId: string,
  providerKey: string,
  token: string,
  generation: SourceGenerationSnapshot,
): SaveIncrementalArticleInput {
  return {
    candidateId,
    expectedProviderKey: providerKey,
    sourceGeneration: generation,
    draft: draft(token),
  };
}

test(
  "rollback drill: a stale in-flight task cannot write an Article after active→shadow generation change",
  { skip: !enabled },
  async () => {
    const token = randomUUID().replace(/-/g, "").slice(0, 12);

    // 1. ACTIVE source at generation N; capture the in-flight task's snapshot.
    const source = await createDiscoverySource({
      lifecycleMode: ACTIVE,
      leaseOwner: null,
      definitionVersion: DEFINITION_VERSION,
      activatedAt: ACTIVATED_AT,
      activationGeneration: 0,
      nextRunAt: new Date(),
    });
    const staleSnapshot: SourceGenerationSnapshot = {
      definitionVersion: DEFINITION_VERSION,
      activatedAt: ACTIVATED_AT,
      activationGeneration: 0,
    };

    // The stale in-flight task's own candidate (mid-ingest, no Article yet).
    const staleCandidate = await createCrawlCandidate({
      providerKey: source.providerKey,
      discoverySourceId: source.id,
      status: CrawlCandidateStatus.INGESTING,
    });

    // A second candidate with a PENDING ingest job that the rollback must cancel,
    // plus a ledger observation that the rollback must preserve.
    const pendingCandidate = await createCrawlCandidate({
      providerKey: source.providerKey,
      discoverySourceId: source.id,
      status: CrawlCandidateStatus.QUEUED,
    });
    const pendingJob = await prisma.$transaction((tx) =>
      enqueueCandidateIngestInTx(tx, pendingCandidate.id),
    );
    jobIds.add(pendingJob.id);
    const observation = await createDiscoveryObservation(source.id);

    // 2. Roll ACTIVE → SHADOW: generation N+1, PENDING job DEAD_LETTERed, ledger kept.
    const rolled = await rollbackActiveToShadow(source.id);
    assert.equal(rolled.committed, true);
    if (rolled.committed) {
      assert.equal(rolled.toMode, SHADOW);
      assert.equal(rolled.activationGeneration, 1, "generation bumped to N+1");
      assert.equal(rolled.cancelledJobCount, 1, "the PENDING ingest job is cancelled");
    }

    const afterRollback = await prisma.discoverySource.findUnique({ where: { id: source.id } });
    assert.equal(afterRollback?.lifecycleMode, SHADOW);
    assert.equal(afterRollback?.activationGeneration, 1);
    assert.equal(afterRollback?.nextRunAt, null, "scheduling parked until re-activation");

    const jobAfter = await prisma.job.findUnique({ where: { id: pendingJob.id } });
    assert.equal(jobAfter?.status, JobStatus.DEAD_LETTER, "PENDING ingest job → DEAD_LETTER");
    assert.equal(jobAfter?.lastError, ROLLBACK_CANCELLED_REASON);

    // Candidates + observations preserved (a later activation can requeue eligible work).
    assert.equal(
      await prisma.crawlCandidate.count({ where: { discoverySourceId: source.id } }),
      2,
      "candidates retained",
    );
    assert.ok(
      await prisma.discoveryObservation.findUnique({ where: { id: observation.id } }),
      "observation retained",
    );

    // 3. The STALE in-flight task commits with the generation-N snapshot → REJECTED.
    const staleResult = await saveIncrementalArticle(
      saveInput(staleCandidate.id, source.providerKey, token, staleSnapshot),
    );
    assert.equal(staleResult.action, "revalidation-failed", "stale save must be refused");
    if (staleResult.action === "revalidation-failed") {
      assert.equal(staleResult.reason, "stale-generation");
    }
    assert.equal(
      await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } }),
      0,
      "the stale task wrote NO Article",
    );
    const staleCandAfter = await prisma.crawlCandidate.findUnique({ where: { id: staleCandidate.id } });
    assert.equal(staleCandAfter?.articleId, null, "the stale candidate is untouched");
    assert.equal(staleCandAfter?.status, CrawlCandidateStatus.INGESTING);

    // 4. Re-activate at generation N+1; a FRESH task in the correct mode succeeds.
    await prisma.discoverySource.update({
      where: { id: source.id },
      data: { lifecycleMode: ACTIVE, nextRunAt: new Date() },
    });
    const freshSnapshot: SourceGenerationSnapshot = {
      definitionVersion: DEFINITION_VERSION,
      activatedAt: ACTIVATED_AT,
      activationGeneration: 1,
    };
    const freshCandidate = await createCrawlCandidate({
      providerKey: source.providerKey,
      discoverySourceId: source.id,
      status: CrawlCandidateStatus.DISCOVERED,
    });
    const freshToken = randomUUID().replace(/-/g, "").slice(0, 12);

    const freshResult = await saveIncrementalArticle(
      saveInput(freshCandidate.id, source.providerKey, freshToken, freshSnapshot),
    );
    assert.equal(freshResult.action, "saved", "a fresh task at generation N+1 still saves");
    if (freshResult.action === "saved") {
      articleIds.add(freshResult.articleId);
      const savedCand = await prisma.crawlCandidate.findUnique({ where: { id: freshCandidate.id } });
      assert.equal(savedCand?.status, CrawlCandidateStatus.INGESTED);
      assert.equal(savedCand?.articleId, freshResult.articleId);
    }
  },
);
