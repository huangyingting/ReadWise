/**
 * Force-rescrape content-version integration tests (#1102, Phase 3.3).
 *
 * Engine-agnostic like `article-save-commit.test.ts`: runs on SQLite by default
 * under `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL `requestForceRescrape` /
 * `createPendingRescrape` / `activateRescrape` against the live database and
 * proves the four acceptance criteria:
 *
 *   - AC1: a FAILED force-rescrape (fetch fail-closed, and a fully-valid draft
 *     blocked by the fail-closed annotation gate) leaves the original ACTIVE
 *     content, the Article's readable fields, and every reader Highlight
 *     UNCHANGED — only a REJECTED/FAILED version row is recorded.
 *   - AC2: a SUCCESSFUL force-rescrape keeps the SAME Article id, swaps the
 *     readable content in place, records who requested it + the reason on the new
 *     ACTIVE version, marks derived outputs for regeneration, and demotes the old
 *     version to SUPERSEDED (never deletes/recreates the Article).
 *   - AC3: normal incremental discovery (`saveIncrementalArticle`) — even a
 *     repeat rediscovery of the same identity — NEVER creates an
 *     `ArticleContentVersion` (the governing invariant / no-smuggle guarantee).
 *   - AC4: two concurrent force-rescrapes serialize to exactly ONE PENDING
 *     version (the other is rejected cleanly, losing neither version), and a
 *     fault injected mid-activation rolls the whole swap back all-or-nothing.
 *
 * The force-rescrape Articles/users use the shared PREFIX so the shared cleanup
 * sweeps them (deleting the Article cascades its content versions + highlights);
 * the AC3 Article created by the normal save carries a cuid id (no PREFIX), so a
 * local afterEach tracks and deletes it. Versioned content lives ONLY on the
 * content-version rows and is asserted directly here — never via a log or DTO.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import {
  ArticleContentVersionStatus,
  CrawlCandidateStatus,
  DiscoverySourceLifecycleMode,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { articleProcessDedupeKey } from "@/lib/jobs/enqueue";
import {
  saveIncrementalArticle,
  type ArticleDraft,
  type SaveIncrementalArticleInput,
} from "@/lib/scraper/incremental/article-save-commit";
import { computeProseFingerprint } from "@/lib/scraper/incremental/prose-fingerprint";
import { requestForceRescrape, type PrepareRescrapeDraft } from "@/lib/scraper/incremental/force-rescrape-runner";
import { activateRescrape, createPendingRescrape } from "@/lib/scraper/incremental/force-rescrape-commit";

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup, id } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

const S = ArticleContentVersionStatus;
const ORIGINAL_BODY = "The original readable body of this article. The quick brown fox jumped over the lazy dog.";
const REPLACEMENT_BODY = "The freshly rescraped replacement body. A wholly different set of sentences entirely.";

// The AC3 Article gets a cuid id from the normal save (no PREFIX), so track it.
const cuidArticleIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const ids = [...cuidArticleIds];
  if (ids.length > 0) {
    await prisma.job.deleteMany({ where: { dedupeKey: { in: ids.map((i) => articleProcessDedupeKey(i)) } } });
    await prisma.crawlCandidate.updateMany({ where: { articleId: { in: ids } }, data: { articleId: null } });
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
  }
  cuidArticleIds.clear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createPublicArticle(body = ORIGINAL_BODY, title = "Original Title"): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title,
      content: body,
      excerpt: "Original excerpt.",
      author: "Original Author",
      source: "Original Source",
      sourceUrl: `https://example.com/${articleId}`,
      canonicalUrl: `https://example.com/${articleId}`,
      wordCount: 42,
      readingMinutes: 1,
    },
  });
  return articleId;
}

async function addHighlight(articleId: string): Promise<string> {
  const userId = id("user");
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.com`, name: "Reader" } });
  const highlight = await prisma.highlight.create({
    data: { userId, articleId, quote: "quick brown fox", startOffset: 4, endOffset: 19 },
  });
  return highlight.id;
}

/** A prepare seam that returns a fully-valid replacement (all signals clean). */
function preparedDraft(body = REPLACEMENT_BODY, title = "Refreshed Title"): PrepareRescrapeDraft {
  return async (ctx) => ({
    kind: "prepared",
    content: {
      content: body,
      title,
      excerpt: "Refreshed excerpt.",
      author: "Refreshed Author",
      source: "Refreshed Source",
      wordCount: 55,
      readingMinutes: 2,
      sourceUrl: ctx.article.sourceUrl,
      canonicalUrl: ctx.article.canonicalUrl,
    },
    signals: { bodyPresent: true, canonical: "match", safety: "safe", quality: "pass" },
  });
}

// ---------------------------------------------------------------------------
// AC1 — a FAILED force-rescrape retains the original active content + readers
// ---------------------------------------------------------------------------

test("AC1: the default fail-closed fetch records a FAILED version and retains the active content", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createPublicArticle();

  // No prepareDraft override ⇒ the production seam fails closed (fetch_failed).
  const outcome = await requestForceRescrape({ articleId, reason: "publisher correction", requestedById: "op-1" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") return;
  assert.equal(outcome.reason, "fetch_failed");

  // The Article's readable content is untouched.
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(article.content, ORIGINAL_BODY);
  assert.equal(article.title, "Original Title");

  // The ACTIVE version is the materialized baseline (original body), and the
  // pending row is terminal FAILED with a code — never storing a proposed body.
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.status, S.ACTIVE);
  assert.equal(active.content, ORIGINAL_BODY);
  const failed = await prisma.articleContentVersion.findUniqueOrThrow({ where: { id: outcome.versionId } });
  assert.equal(failed.status, S.FAILED);
  assert.equal(failed.failureReason, "fetch_failed");
  assert.equal(failed.pendingForArticleId, null, "pending lock released");
  assert.equal(failed.content, "", "a failed version never stores a proposed body");

  // Exactly one version holds the pending/active slots (no slot leak).
  assert.equal(await prisma.articleContentVersion.count({ where: { pendingForArticleId: articleId } }), 0);
  assert.equal(await prisma.articleContentVersion.count({ where: { activeForArticleId: articleId } }), 1);
});

test("AC1: a fully-valid replacement blocked by the fail-closed annotation gate retains everything", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createPublicArticle();
  const highlightId = await addHighlight(articleId);

  // The draft is perfectly valid — only the annotation gate (no migrator wired
  // in #1102) blocks activation, so the old version must be retained.
  const outcome = await requestForceRescrape(
    { articleId, reason: "publisher correction", requestedById: "op-2" },
    { prepareDraft: preparedDraft() },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") return;
  assert.equal(outcome.reason, "annotation_migration_required");

  // Article readable content + the reader's highlight are untouched.
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(article.content, ORIGINAL_BODY);
  const highlight = await prisma.highlight.findUnique({ where: { id: highlightId } });
  assert.ok(highlight, "reader highlight preserved");
  assert.equal(highlight?.articleId, articleId);

  // Active version still the original baseline; the pending row is REJECTED
  // (a deliberate validation-gate refusal, not a fetch/internal FAILED).
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.content, ORIGINAL_BODY);
  const rejected = await prisma.articleContentVersion.findUniqueOrThrow({ where: { id: outcome.versionId } });
  assert.equal(rejected.status, S.REJECTED);
  assert.equal(rejected.failureReason, "annotation_migration_required");
  assert.equal(rejected.content, "", "the validated replacement body is never persisted on a rejected row");
});

// ---------------------------------------------------------------------------
// AC2 — a SUCCESSFUL force-rescrape keeps the same id + records who/why
// ---------------------------------------------------------------------------

test("AC2: a successful force-rescrape swaps content in place, keeps the id, and records provenance", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createPublicArticle();
  const before = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });

  const outcome = await requestForceRescrape(
    { articleId, reason: "legal takedown correction", requestedById: "approver-9" },
    { prepareDraft: preparedDraft() },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "activated");
  if (outcome.kind !== "activated") return;
  assert.equal(outcome.articleId, articleId, "same Article id — never deleted/recreated");
  assert.ok(outcome.supersededVersionId, "the old baseline was superseded");

  // The Article kept its identity but swapped its readable version in place.
  const after = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(after.id, before.id);
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime(), "identity/createdAt preserved");
  assert.equal(after.ownerId, before.ownerId, "ownership preserved");
  assert.equal(after.visibility, before.visibility, "visibility preserved");
  assert.equal(after.sourceUrl, before.sourceUrl, "canonical/source identity preserved");
  assert.equal(after.content, REPLACEMENT_BODY, "readable content replaced");
  assert.equal(after.title, "Refreshed Title");

  // The new ACTIVE version records who + why and marks derived outputs.
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.id, outcome.versionId);
  assert.equal(active.status, S.ACTIVE);
  assert.equal(active.content, REPLACEMENT_BODY);
  assert.equal(active.reason, "legal takedown correction", "operator justification recorded");
  assert.equal(active.requestedById, "approver-9", "requester recorded");
  assert.ok(active.fingerprint, "versioned fingerprint stored");
  assert.ok(active.derivedRegenerationRequestedAt, "derived outputs marked for regeneration (#1103 seam)");

  // The old version is SUPERSEDED and released its active slot; exactly one active.
  const superseded = await prisma.articleContentVersion.findUniqueOrThrow({ where: { id: outcome.supersededVersionId! } });
  assert.equal(superseded.status, S.SUPERSEDED);
  assert.equal(superseded.activeForArticleId, null);
  assert.ok(superseded.supersededAt);
  assert.equal(await prisma.articleContentVersion.count({ where: { activeForArticleId: articleId } }), 1);
});

// ---------------------------------------------------------------------------
// AC3 — normal incremental discovery never creates a content version
// ---------------------------------------------------------------------------

test("AC3: normal incremental save (and repeat rediscovery) creates NO content version", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    definitionVersion: 2,
    activatedAt: new Date("2026-05-01T00:00:00.000Z"),
  });
  const cand = await createCrawlCandidate({
    providerKey: src.providerKey,
    discoverySourceId: src.id,
    status: CrawlCandidateStatus.DISCOVERED,
  });

  const prose = "A normal incremental article body. The quick brown fox jumped over the lazy dog.";
  const fp = computeProseFingerprint(prose);
  const draft: ArticleDraft = {
    title: `Normal ${token}`,
    content: prose,
    author: "A. Writer",
    excerpt: "An excerpt.",
    source: "Test Provider",
    sourceUrl: `https://example.com/${token}`,
    canonicalUrl: `https://example.com/${token}`,
  };
  const input: SaveIncrementalArticleInput = {
    candidateId: cand.id,
    expectedProviderKey: src.providerKey,
    sourceGeneration: { definitionVersion: 2, activatedAt: new Date("2026-05-01T00:00:00.000Z"), activationGeneration: 0 },
    draft,
    fingerprint: fp ? { version: fp.version, hash: fp.hash } : null,
  };

  const first = await saveIncrementalArticle(input);
  assert.equal(first.action, "saved");
  if (first.action !== "saved") return;
  cuidArticleIds.add(first.articleId);

  // The normal save path must NEVER materialize a content version.
  assert.equal(
    await prisma.articleContentVersion.count({ where: { articleId: first.articleId } }),
    0,
    "normal incremental ingestion created no ArticleContentVersion",
  );

  // Rediscovering the SAME known identity (idempotent re-save) still creates none.
  const second = await saveIncrementalArticle(input);
  assert.ok(second.action === "known-article-untouched" || second.action === "converged");
  assert.equal(
    await prisma.articleContentVersion.count({ where: { articleId: first.articleId } }),
    0,
    "rediscovery of a known Article created no ArticleContentVersion",
  );
  // And no active/pending slot was ever claimed by the normal path.
  assert.equal(await prisma.articleContentVersion.count({ where: { activeForArticleId: first.articleId } }), 0);
  assert.equal(await prisma.articleContentVersion.count({ where: { pendingForArticleId: first.articleId } }), 0);
});

// ---------------------------------------------------------------------------
// AC4 — concurrent refreshes serialize; activation is all-or-nothing
// ---------------------------------------------------------------------------

test("AC4: two concurrent pending claims serialize to exactly one, losing neither version", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createPublicArticle();
  const baseline = { content: ORIGINAL_BODY, title: "Original Title" };

  const [a, b] = await Promise.all([
    createPendingRescrape({ articleId, reason: "refresh A", requestedById: "op-a", baseline }),
    createPendingRescrape({ articleId, reason: "refresh B", requestedById: "op-b", baseline }),
  ]);

  const oks = [a, b].filter((r) => r.ok);
  const conflicts = [a, b].filter((r) => !r.ok);
  assert.equal(oks.length, 1, "exactly one concurrent force-rescrape claimed the pending lock");
  assert.equal(conflicts.length, 1, "the other was rejected cleanly (no lost version)");
  assert.equal((conflicts[0] as { reason?: string }).reason, "conflict");

  // Exactly one PENDING version and one ACTIVE baseline — neither lost.
  assert.equal(await prisma.articleContentVersion.count({ where: { pendingForArticleId: articleId } }), 1);
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.status, S.ACTIVE);
  assert.equal(active.content, ORIGINAL_BODY, "current version fully intact");
});

test("AC4: a fault mid-activation rolls the whole swap back (all-or-nothing)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createPublicArticle();
  const pending = await createPendingRescrape({
    articleId,
    reason: "refresh",
    requestedById: "op-c",
    baseline: { content: ORIGINAL_BODY, title: "Original Title" },
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) return;
  const baselineVersionId = pending.baselineVersionId;

  // Inject a fault at the LAST write (the Article update): the whole tx must roll back.
  await assert.rejects(
    activateRescrape({
      articleId,
      pendingVersionId: pending.pendingVersionId,
      content: { content: REPLACEMENT_BODY, title: "Refreshed Title" },
      debugHooks: {
        beforeArticleUpdate: () => {
          throw new Error("injected fault");
        },
      },
    }),
    /injected fault/,
  );

  // Nothing changed: Article body intact, old version still ACTIVE, pending still PENDING.
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(article.content, ORIGINAL_BODY, "Article readable content unchanged after rollback");
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.id, baselineVersionId);
  assert.equal(active.status, S.ACTIVE);
  const stillPending = await prisma.articleContentVersion.findUniqueOrThrow({ where: { id: pending.pendingVersionId } });
  assert.equal(stillPending.status, S.PENDING, "pending version not promoted");
  assert.equal(stillPending.content, "", "no proposed content leaked onto the pending row");
});
