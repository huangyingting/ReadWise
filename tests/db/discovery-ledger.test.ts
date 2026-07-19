/**
 * Incremental discovery ledger integration tests (#1081).
 *
 * Unlike the `postgres-*.test.ts` suites, this file is ENGINE-AGNOSTIC: it runs
 * against whichever database `test:db` targets (SQLite by default, PostgreSQL
 * when DATABASE_URL points at Postgres) so both engines prove the same schema
 * intent — creation, uniqueness enforcement, orthogonal controlled fields, and
 * the governing invariant that Article deletion never destroys candidate
 * identity.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ArticleStatus,
  ArticleVisibility,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { enabled } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";
import {
  createCanonicalConflict,
  createCrawlCandidate,
  createDiscoveryObservation,
  createDiscoverySource,
  createUrlAlias,
  providerKey,
} from "./support/discovery-fixtures";

registerIntegrationCleanup();

const DUPLICATE_KEY_ERROR = /Unique constraint failed|Unique constraint|duplicate key value/;

async function createPublicArticle(articleId: string): Promise<void> {
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Ledger fixture article",
      content: "Representative body for candidate-linkage tests.",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      publishedAt: new Date(),
    },
  });
}

test("creates every ledger model and reads them back", { skip: !enabled }, async () => {
  const provider = providerKey();
  const source = await createDiscoverySource({ providerKey: provider, sourceKey: "feed" });
  const candidate = await createCrawlCandidate({
    providerKey: provider,
    discoverySourceId: source.id,
    canonicalKey: id("canonical"),
  });
  const alias = await createUrlAlias(candidate.id, provider);
  const observation = await createDiscoveryObservation(source.id, { candidateId: candidate.id });
  const conflict = await createCanonicalConflict(provider, { incumbentCandidateId: candidate.id });

  assert.equal(await prisma.discoverySource.count({ where: { id: source.id } }), 1);
  assert.equal(await prisma.crawlCandidate.count({ where: { id: candidate.id } }), 1);
  assert.equal(await prisma.urlAlias.count({ where: { id: alias.id } }), 1);
  assert.equal(await prisma.discoveryObservation.count({ where: { id: observation.id } }), 1);
  assert.equal(await prisma.canonicalConflict.count({ where: { id: conflict.id } }), 1);
});

test("stores role, lifecycle mode, automation policy, and health as orthogonal fields", { skip: !enabled }, async () => {
  const source = await createDiscoverySource({
    role: DiscoverySourceRole.SITEMAP,
    lifecycleMode: DiscoverySourceLifecycleMode.SHADOW,
    automationPolicy: DiscoveryAutomationPolicy.SCHEDULED,
    health: DiscoverySourceHealth.DEGRADED,
    gapState: DiscoveryGapState.SUSPECTED,
  });

  const stored = await prisma.discoverySource.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(stored.role, DiscoverySourceRole.SITEMAP);
  assert.equal(stored.lifecycleMode, DiscoverySourceLifecycleMode.SHADOW);
  assert.equal(stored.automationPolicy, DiscoveryAutomationPolicy.SCHEDULED);
  assert.equal(stored.health, DiscoverySourceHealth.DEGRADED);
  assert.equal(stored.gapState, DiscoveryGapState.SUSPECTED);
});

test("rejects a duplicate source version (providerKey, sourceKey, definitionVersion)", { skip: !enabled }, async () => {
  const provider = providerKey();
  await createDiscoverySource({ providerKey: provider, sourceKey: "feed", definitionVersion: 1 });

  await assert.rejects(
    createDiscoverySource({ providerKey: provider, sourceKey: "feed", definitionVersion: 1 }),
    DUPLICATE_KEY_ERROR,
  );

  // A bumped definitionVersion is an independent source and is allowed.
  await createDiscoverySource({ providerKey: provider, sourceKey: "feed", definitionVersion: 2 });
  assert.equal(await prisma.discoverySource.count({ where: { providerKey: provider } }), 2);
});

test("rejects a duplicate provisional candidate identity", { skip: !enabled }, async () => {
  const provider = providerKey();
  const provisionalKey = id("provisional");
  await createCrawlCandidate({ providerKey: provider, identityVersion: 1, provisionalKey });

  await assert.rejects(
    createCrawlCandidate({ providerKey: provider, identityVersion: 1, provisionalKey }),
    DUPLICATE_KEY_ERROR,
  );

  // Same provisional key under a new identityVersion is a distinct identity.
  await createCrawlCandidate({ providerKey: provider, identityVersion: 2, provisionalKey });
  assert.equal(await prisma.crawlCandidate.count({ where: { providerKey: provider } }), 2);
});

test("rejects a duplicate final canonical identity but allows many un-canonicalized candidates", { skip: !enabled }, async () => {
  const provider = providerKey();
  const canonicalKey = id("canonical");
  await createCrawlCandidate({ providerKey: provider, canonicalKey });

  await assert.rejects(
    createCrawlCandidate({ providerKey: provider, canonicalKey }),
    DUPLICATE_KEY_ERROR,
  );

  // Null canonicalKey rows are not yet canonicalized and never collide.
  await createCrawlCandidate({ providerKey: provider, canonicalKey: null });
  await createCrawlCandidate({ providerKey: provider, canonicalKey: null });
  assert.equal(
    await prisma.crawlCandidate.count({ where: { providerKey: provider, canonicalKey: null } }),
    2,
  );
});

test("rejects a duplicate alias identity", { skip: !enabled }, async () => {
  const provider = providerKey();
  const candidate = await createCrawlCandidate({ providerKey: provider });
  const aliasKey = id("alias");
  await createUrlAlias(candidate.id, provider, { identityVersion: 1, aliasKey });

  await assert.rejects(
    createUrlAlias(candidate.id, provider, { identityVersion: 1, aliasKey }),
    DUPLICATE_KEY_ERROR,
  );
});

test("rejects a duplicate observation for the same source (idempotency)", { skip: !enabled }, async () => {
  const source = await createDiscoverySource();
  const observationKey = id("observation");
  await createDiscoveryObservation(source.id, { observationKey });

  await assert.rejects(
    createDiscoveryObservation(source.id, { observationKey }),
    DUPLICATE_KEY_ERROR,
  );
});

test("rejects a duplicate open canonical conflict identity", { skip: !enabled }, async () => {
  const provider = providerKey();
  const canonicalKey = id("canonical");
  await createCanonicalConflict(provider, { identityVersion: 1, canonicalKey });

  await assert.rejects(
    createCanonicalConflict(provider, { identityVersion: 1, canonicalKey }),
    DUPLICATE_KEY_ERROR,
  );
});

test("Article deletion preserves candidate identity, aliases, and terminal history", { skip: !enabled }, async () => {
  const provider = providerKey();
  const articleId = id("ledger_article");
  await createPublicArticle(articleId);

  const source = await createDiscoverySource({ providerKey: provider });
  const canonicalKey = id("canonical");
  const provisionalKey = id("provisional");
  const candidate = await createCrawlCandidate({
    providerKey: provider,
    discoverySourceId: source.id,
    provisionalKey,
    canonicalKey,
    status: CrawlCandidateStatus.INGESTED,
    ingestedAt: new Date(),
    articleId,
  });
  const alias = await createUrlAlias(candidate.id, provider);
  const conflict = await createCanonicalConflict(provider, { incumbentCandidateId: candidate.id });

  // Deleting the Article must NOT delete or reset the candidate identity.
  await prisma.article.delete({ where: { id: articleId } });

  const preserved = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.ok(preserved, "candidate row must survive Article deletion");
  assert.equal(preserved?.articleId, null, "articleId is nulled (SetNull), not cascade-deleted");
  assert.equal(preserved?.status, CrawlCandidateStatus.INGESTED, "terminal status is retained");
  assert.equal(preserved?.provisionalKey, provisionalKey, "provisional identity is retained");
  assert.equal(preserved?.canonicalKey, canonicalKey, "canonical identity is retained");
  assert.ok(preserved?.ingestedAt, "ingestion history is retained");

  // Aliases and conflicts (permanent ledger) also survive Article deletion.
  assert.equal(await prisma.urlAlias.count({ where: { id: alias.id } }), 1);
  assert.equal(await prisma.canonicalConflict.count({ where: { id: conflict.id } }), 1);

  // A re-observation of the same provisional identity must collide, proving the
  // known URL can never be silently re-ingested as a fresh candidate.
  await assert.rejects(
    createCrawlCandidate({ providerKey: provider, identityVersion: 1, provisionalKey }),
    DUPLICATE_KEY_ERROR,
  );
});

test("deleting a DiscoverySource expires its observations but preserves the candidate", { skip: !enabled }, async () => {
  const provider = providerKey();
  const source = await createDiscoverySource({ providerKey: provider });
  const candidate = await createCrawlCandidate({
    providerKey: provider,
    discoverySourceId: source.id,
  });
  const observation = await createDiscoveryObservation(source.id, { candidateId: candidate.id });

  await prisma.discoverySource.delete({ where: { id: source.id } });

  assert.equal(
    await prisma.discoveryObservation.count({ where: { id: observation.id } }),
    0,
    "source-run observations expire with their DiscoverySource",
  );
  const preserved = await prisma.crawlCandidate.findUnique({ where: { id: candidate.id } });
  assert.ok(preserved, "candidate survives source deletion");
  assert.equal(preserved?.discoverySourceId, null, "discoverySourceId is nulled (SetNull)");
});

test("resolving a canonical conflict records the outcome", { skip: !enabled }, async () => {
  const provider = providerKey();
  const conflict = await createCanonicalConflict(provider);

  const resolved = await prisma.canonicalConflict.update({
    where: { id: conflict.id },
    data: {
      status: CanonicalConflictStatus.RESOLVED,
      resolvedAt: new Date(),
      resolvedBy: "operator",
      reason: "kept-incumbent",
    },
  });

  assert.equal(resolved.status, CanonicalConflictStatus.RESOLVED);
  assert.ok(resolved.resolvedAt);
});

test("alias kinds cover the controlled identity-mapping vocabulary", { skip: !enabled }, async () => {
  const provider = providerKey();
  const candidate = await createCrawlCandidate({ providerKey: provider });
  const kinds = [
    UrlAliasKind.PROVISIONAL,
    UrlAliasKind.REDIRECT,
    UrlAliasKind.CANONICAL,
    UrlAliasKind.DUPLICATE,
    UrlAliasKind.MIRROR,
  ];

  for (const kind of kinds) {
    await createUrlAlias(candidate.id, provider, { kind, aliasKey: id("alias") });
  }

  assert.equal(await prisma.urlAlias.count({ where: { candidateId: candidate.id } }), kinds.length);
});
