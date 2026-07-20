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
  JobType,
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
import { createAnnotationMigrator } from "@/lib/scraper/incremental/annotation-migrator";
import {
  requestDerivedRegeneration,
  rescrapeRegenDedupeKey,
  rescrapeRegenStepKey,
  CONTENT_DERIVED_FEATURE_STEPS,
} from "@/lib/scraper/incremental/derived-regeneration";

import { enabled, PREFIX } from "./support/db-config";
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
  // #1103 regeneration jobs are keyed by the (prefixed) Article id but their
  // dedupeKey does not START with the prefix, so the shared sweep misses them.
  await prisma.job.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
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
// #1103 re-anchoring fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a reader-accurate W3C anchor (quote + offsets + ±24-char prefix/suffix)
 * for the `occurrence`-th appearance of `quote` in `text`, mirroring how the
 * Reader records a highlight. Throws if the fixture quote is absent so a broken
 * fixture fails loudly rather than silently mis-anchoring.
 */
function anchorFor(
  text: string,
  quote: string,
  occurrence = 1,
): { quote: string; start: number; end: number; prefix: string; suffix: string } {
  let idx = -1;
  for (let n = 0; n < occurrence; n += 1) {
    idx = text.indexOf(quote, idx + 1);
    if (idx === -1) throw new Error(`fixture quote not found (occurrence ${occurrence}): ${quote}`);
  }
  return {
    quote,
    start: idx,
    end: idx + quote.length,
    prefix: text.slice(Math.max(0, idx - 24), idx),
    suffix: text.slice(idx + quote.length, idx + quote.length + 24),
  };
}

/** Creates a prefixed reader user (swept by the shared cleanup). */
async function createReader(): Promise<string> {
  const userId = id("user");
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.com`, name: "Reader" } });
  return userId;
}

/** Inserts a highlight anchor at explicit offsets/context and returns its id. */
async function createAnchor(
  articleId: string,
  userId: string,
  anchor: { quote: string; start: number; end: number; prefix?: string; suffix?: string },
): Promise<string> {
  const row = await prisma.highlight.create({
    data: {
      userId,
      articleId,
      quote: anchor.quote,
      startOffset: anchor.start,
      endOffset: anchor.end,
      prefix: anchor.prefix ?? "",
      suffix: anchor.suffix ?? "",
    },
  });
  return row.id;
}

/**
 * A deterministic production migrator whose Reader-text deriver is the identity
 * function: the fixtures use plain-text bodies (no HTML), so char offsets line up
 * exactly with the content. This exercises the REAL `createAnnotationMigrator` →
 * `buildReanchorPlan` → `revalidateAnchor` pipeline against the live database.
 */
const identityMigrator = createAnnotationMigrator({ deriveReaderText: (content) => content });

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
  // The governing invariant also forbids regeneration off ordinary discovery:
  // no per-version regeneration claim step is ever created (#1103).
  assert.equal(
    await prisma.articleProcessingStep.count({
      where: { articleId: first.articleId, step: { startsWith: "rescrape-regen:" } },
    }),
    0,
    "normal discovery triggered no derived-output regeneration",
  );
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

// ===========================================================================
// #1103 — annotation re-anchoring + derived-output regeneration
//
// These map to issue #1103's acceptance criteria (distinct from the #1102 ACs
// above). A wired migrator re-anchors highlights onto the PROPOSED content; the
// gate BLOCKS unless every anchor migrated reliably; a clean activation migrates
// offsets IN the swap tx and enqueues DEDUPLICATED regeneration of ONLY the
// content-derived outputs — never the article-level relationships.
// ===========================================================================

// ---------------------------------------------------------------------------
// #1103 AC1 — exact + context-assisted anchors migrate to the SAME passage
// ---------------------------------------------------------------------------

test("#1103 AC1: exact and context-assisted anchors migrate to the same passage on activation", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }

  // Exact: the prose up to and including the quote is unchanged, so the stored
  // anchor still sits exactly at its offsets and is migrated in place (no move).
  const exactOld = "The quick brown fox jumped over the lazy dog. Original tail sentence here.";
  const exactNew = "The quick brown fox jumped over the lazy dog. A wholly different, longer tail.";
  const exactArticle = await createPublicArticle(exactOld, "Exact Title");
  const exactUser = await createReader();
  const exactAnchor = anchorFor(exactOld, "quick brown fox");
  const exactId = await createAnchor(exactArticle, exactUser, exactAnchor);

  const exactOutcome = await requestForceRescrape(
    { articleId: exactArticle, reason: "publisher correction", requestedById: "op-a1" },
    { prepareDraft: preparedDraft(exactNew, "Exact Refreshed"), annotationMigrator: identityMigrator },
  );
  assert.equal(exactOutcome.kind, "activated");
  const exactAfter = await prisma.highlight.findUniqueOrThrow({ where: { id: exactId } });
  assert.equal(exactAfter.startOffset, exactAnchor.start, "exact anchor offsets unchanged");
  assert.equal(exactAfter.endOffset, exactAnchor.end);
  const exactArticleRow = await prisma.article.findUniqueOrThrow({ where: { id: exactArticle } });
  assert.equal(
    exactArticleRow.content.slice(exactAfter.startOffset, exactAfter.endOffset),
    "quick brown fox",
    "exact anchor still slices its quote on the new content",
  );

  // Context-assisted: the quote REPEATS in the new content; the stored
  // prefix/suffix context pins the CORRECT (second) occurrence — a naive indexOf
  // would latch onto the first. The anchor must migrate to the right passage.
  const ctxOld = "Alpha note. The summary said the result was final today. End.";
  const ctxNew = "Early on the result was unclear. Alpha note. The summary said the result was final today. End.";
  const ctxArticle = await createPublicArticle(ctxOld, "Ctx Title");
  const ctxUser = await createReader();
  const ctxAnchor = anchorFor(ctxOld, "the result was");
  const ctxId = await createAnchor(ctxArticle, ctxUser, ctxAnchor);

  const ctxOutcome = await requestForceRescrape(
    { articleId: ctxArticle, reason: "publisher correction", requestedById: "op-a2" },
    { prepareDraft: preparedDraft(ctxNew, "Ctx Refreshed"), annotationMigrator: identityMigrator },
  );
  assert.equal(ctxOutcome.kind, "activated");
  const ctxAfter = await prisma.highlight.findUniqueOrThrow({ where: { id: ctxId } });
  const secondOccurrence = anchorFor(ctxNew, "the result was", 2);
  const firstOccurrence = anchorFor(ctxNew, "the result was", 1);
  assert.equal(ctxAfter.startOffset, secondOccurrence.start, "context resolved to the correct (second) passage");
  assert.equal(ctxAfter.endOffset, secondOccurrence.end);
  assert.notEqual(ctxAfter.startOffset, firstOccurrence.start, "did not latch onto the naive-indexOf first occurrence");
  const ctxArticleRow = await prisma.article.findUniqueOrThrow({ where: { id: ctxArticle } });
  assert.equal(
    ctxArticleRow.content.slice(ctxAfter.startOffset, ctxAfter.endOffset),
    "the result was",
    "context anchor slices its quote at the migrated offsets",
  );
});

// ---------------------------------------------------------------------------
// #1103 AC2 — ambiguous/missing anchors block, retain the old version, expose ids
// ---------------------------------------------------------------------------

test("#1103 AC2: ambiguous/missing anchors block activation, retain the old version, and expose (never drop) the uncertain ids", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const oldBody = "We discussed the plan today. The meeting covered the roadmap thoroughly and ended.";
  const newBody = "First, the plan changed. We discussed the plan again. The meeting covered the roadmap and ended.";
  const articleId = await createPublicArticle(oldBody, "AC2 Title");
  const user = await createReader();

  const reliable = anchorFor(oldBody, "roadmap"); // unique in both → would move if activated
  const ambiguous = anchorFor(oldBody, "the plan"); // once here, twice in newBody
  const missing = anchorFor(oldBody, "thoroughly"); // removed in newBody
  const reliableId = await createAnchor(articleId, user, reliable);
  // Empty context makes the repeated quote genuinely ambiguous (no unique hit).
  const ambiguousId = await createAnchor(articleId, user, { ...ambiguous, prefix: "", suffix: "" });
  const missingId = await createAnchor(articleId, user, missing);

  const outcome = await requestForceRescrape(
    { articleId, reason: "publisher correction", requestedById: "op-b1" },
    { prepareDraft: preparedDraft(newBody, "AC2 Refreshed"), annotationMigrator: identityMigrator },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") return;
  assert.equal(outcome.reason, "annotation_migration_required");

  // Old ACTIVE version + Article content fully retained.
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(article.content, oldBody, "article content unchanged");
  const active = await prisma.articleContentVersion.findUniqueOrThrow({ where: { activeForArticleId: articleId } });
  assert.equal(active.content, oldBody);
  assert.equal(active.status, S.ACTIVE);

  // The rejected version stamps the unresolved anchor ids/count — METADATA ONLY.
  const rejected = await prisma.articleContentVersion.findUniqueOrThrow({ where: { id: outcome.versionId } });
  assert.equal(rejected.status, S.REJECTED);
  assert.equal(rejected.failureReason, "annotation_migration_required");
  assert.equal(rejected.unresolvedAnchorCount, 2, "both uncertain anchors counted");
  const unresolvedIds = (rejected.unresolvedAnchorIds ?? []) as string[];
  assert.deepEqual(
    [...unresolvedIds].sort(),
    [ambiguousId, missingId].sort(),
    "the uncertain anchor ids are exposed for confirmation",
  );
  assert.ok(!unresolvedIds.includes(reliableId), "the reliable anchor is not flagged");

  // NONE of the three anchors were deleted or moved — even the reliable one stays
  // put because the WHOLE activation was blocked.
  const rows = await prisma.highlight.findMany({ where: { articleId } });
  assert.equal(rows.length, 3, "no anchor deleted");
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(reliableId)?.startOffset, reliable.start, "reliable anchor not moved (activation blocked)");
  assert.equal(byId.get(reliableId)?.endOffset, reliable.end);
  assert.equal(byId.get(ambiguousId)?.startOffset, ambiguous.start, "ambiguous anchor not moved");
  assert.equal(byId.get(missingId)?.startOffset, missing.start, "missing anchor not moved");
});

// ---------------------------------------------------------------------------
// #1103 AC3 — activation regenerates each affected output once; article-level untouched
// ---------------------------------------------------------------------------

test("#1103 AC3: activation regenerates each affected derived output at-most-once and leaves article-level data untouched", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const oldBody = "Third article original prose about geography and rivers and lakes.";
  const newBody = "Third article refreshed prose about mountains and valleys and peaks.";
  const articleId = await createPublicArticle(oldBody, "AC3 Title");

  // Seed CONTENT-POSITION derived outputs (their basis is the prose → regenerate).
  await prisma.article.update({
    where: { id: articleId },
    data: { difficulty: "B2", difficultyScore: 0.62, lexileApprox: 900, difficultyVersion: "v1" },
  });
  await prisma.translation.create({ data: { articleId, targetLang: "es", content: "es-cache" } });
  await prisma.translation.create({ data: { articleId, targetLang: "fr", content: "fr-cache" } });
  await prisma.sentenceTranslation.create({
    data: { articleId, sourceHash: "hash-1", targetLang: "es", translation: "s-cache" },
  });
  await prisma.vocabularyItem.create({ data: { articleId, word: "river", explanation: "e", example: "x" } });
  await prisma.quizQuestion.create({ data: { articleId, question: "Q1?", options: ["a", "b"], correctIndex: 0 } });
  const tagId = id("tag");
  await prisma.tag.create({ data: { id: tagId, name: "Geography", slug: tagId } });
  await prisma.articleTag.create({ data: { articleId, tagId } });
  await prisma.grammarExplanation.create({ data: { articleId, phrase: "used to", explanation: "e" } });
  await prisma.articleSpeech.create({ data: { articleId, words: [] } });
  await prisma.articleProcessingStep.create({ data: { articleId, step: "difficulty", status: "generated" } });
  await prisma.articleProcessingStep.create({ data: { articleId, step: "translation:es", status: "generated" } });
  await prisma.articleProcessingStep.create({ data: { articleId, step: "speech", status: "generated" } });

  // Seed ARTICLE-LEVEL relationships (attached to identity → must remain intact).
  const reader = await createReader();
  await prisma.readingProgress.create({ data: { userId: reader, articleId, percent: 73, completed: false } });
  await prisma.articleMastery.create({ data: { userId: reader, articleId, comprehensionScore: 0.8 } });
  const list = await prisma.readingList.create({ data: { userId: reader, name: `list-${reader}` } });
  await prisma.readingListItem.create({ data: { listId: list.id, articleId } });

  const outcome = await requestForceRescrape(
    { articleId, reason: "publisher correction", requestedById: "op-c1" },
    { prepareDraft: preparedDraft(newBody, "AC3 Refreshed") },
  );
  assert.equal(outcome.kind, "activated");
  if (outcome.kind !== "activated") return;
  const versionId = outcome.versionId;

  // Every content-position derived output was invalidated for regeneration.
  assert.equal(await prisma.translation.count({ where: { articleId } }), 0, "translations cleared");
  assert.equal(await prisma.sentenceTranslation.count({ where: { articleId } }), 0, "sentence cache cleared");
  assert.equal(await prisma.vocabularyItem.count({ where: { articleId } }), 0, "vocabulary cleared");
  assert.equal(await prisma.quizQuestion.count({ where: { articleId } }), 0, "quiz cleared");
  assert.equal(await prisma.articleTag.count({ where: { articleId } }), 0, "tags cleared");
  assert.equal(await prisma.grammarExplanation.count({ where: { articleId } }), 0, "grammar cleared");
  assert.equal(await prisma.articleSpeech.count({ where: { articleId } }), 0, "narration cleared");
  const article = await prisma.article.findUniqueOrThrow({ where: { id: articleId } });
  assert.equal(article.difficulty, null, "difficulty nulled");
  assert.equal(article.difficultyScore, null);
  assert.equal(article.lexileApprox, null);
  assert.equal(article.difficultyVersion, null);

  // Feature steps cleared; the per-version regeneration CLAIM step survives.
  assert.equal(
    await prisma.articleProcessingStep.count({ where: { articleId, step: { in: [...CONTENT_DERIVED_FEATURE_STEPS] } } }),
    0,
    "feature steps reset",
  );
  assert.equal(
    await prisma.articleProcessingStep.count({ where: { articleId, step: { startsWith: "translation:" } } }),
    0,
    "language steps reset",
  );
  const claim = await prisma.articleProcessingStep.findFirst({
    where: { articleId, step: rescrapeRegenStepKey(versionId) },
  });
  assert.ok(claim, "the per-version regeneration claim step exists");
  assert.equal(claim?.status, "generated");

  // EXACTLY ONE version-scoped rebuild job, carrying ids + langs only (no text).
  const jobs = await prisma.job.findMany({ where: { dedupeKey: rescrapeRegenDedupeKey(articleId, versionId) } });
  assert.equal(jobs.length, 1, "at most one rebuild job per version");
  assert.equal(jobs[0].type, JobType.AI_REBUILD);
  const payload = jobs[0].payload as { articleId?: string; tts?: boolean; translateLangs?: string[] };
  assert.equal(payload.articleId, articleId, "job payload references the article id");
  assert.deepEqual(payload.translateLangs, ["es", "fr"], "the invalidated languages are re-requested");
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["articleId", "translateLangs", "tts"],
    "job payload carries ids + langs + flag only — no quote/note/content/prompt text",
  );

  // ARTICLE-LEVEL relationships are untouched.
  const progress = await prisma.readingProgress.findUniqueOrThrow({
    where: { userId_articleId: { userId: reader, articleId } },
  });
  assert.equal(progress.percent, 73, "reading progress preserved");
  assert.ok(
    await prisma.articleMastery.findUnique({ where: { userId_articleId: { userId: reader, articleId } } }),
    "mastery preserved",
  );
  assert.equal(await prisma.readingListItem.count({ where: { articleId } }), 1, "reading-list membership preserved");
});

// ---------------------------------------------------------------------------
// #1103 AC4 — worker restart/retry never duplicates versions/steps/jobs/annotations
// ---------------------------------------------------------------------------

test("#1103 AC4: a worker restart/retry never duplicates versions, steps, jobs, or annotations", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const oldBody = "Fourth piece mentions the lighthouse near the rocky shore tonight.";
  const newBody = "A fresh intro sentence. Fourth piece mentions the lighthouse near the rocky shore tonight.";
  const articleId = await createPublicArticle(oldBody, "AC4 Title");
  const user = await createReader();
  const anchor = anchorFor(oldBody, "lighthouse");
  const highlightId = await createAnchor(articleId, user, anchor);

  const outcome = await requestForceRescrape(
    { articleId, reason: "publisher correction", requestedById: "op-d1" },
    { prepareDraft: preparedDraft(newBody, "AC4 Refreshed"), annotationMigrator: identityMigrator },
  );
  assert.equal(outcome.kind, "activated");
  if (outcome.kind !== "activated") return;
  const versionId = outcome.versionId;

  const migrated = anchorFor(newBody, "lighthouse");
  const afterFirst = await prisma.highlight.findUniqueOrThrow({ where: { id: highlightId } });
  assert.equal(afterFirst.startOffset, migrated.start, "anchor migrated to the new position once");

  // Simulate two worker restarts/retries of the SAME downstream regeneration:
  // the per-version claim makes each a safe, non-duplicating no-op.
  const retry1 = await requestDerivedRegeneration({ articleId, versionId });
  const retry2 = await requestDerivedRegeneration({ articleId, versionId });
  assert.equal(retry1.alreadyRequested, true, "retry is a claimed no-op");
  assert.equal(retry2.alreadyRequested, true);

  // No duplication anywhere.
  assert.equal(await prisma.articleContentVersion.count({ where: { activeForArticleId: articleId } }), 1, "one active version");
  assert.equal(await prisma.articleContentVersion.count({ where: { articleId } }), 2, "baseline + active only");
  assert.equal(
    await prisma.articleProcessingStep.count({ where: { articleId, step: rescrapeRegenStepKey(versionId) } }),
    1,
    "one regeneration claim step",
  );
  assert.equal(
    await prisma.job.count({ where: { dedupeKey: rescrapeRegenDedupeKey(articleId, versionId) } }),
    1,
    "one rebuild job",
  );
  assert.equal(await prisma.highlight.count({ where: { articleId } }), 1, "no duplicate annotation");
  const afterRetries = await prisma.highlight.findUniqueOrThrow({ where: { id: highlightId } });
  assert.equal(afterRetries.startOffset, migrated.start, "retry did not re-migrate or duplicate the anchor");
  assert.equal(afterRetries.endOffset, migrated.end);
});
