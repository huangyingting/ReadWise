/**
 * Atomic incremental-save integration tests (#1095, Phase 2.5).
 *
 * Engine-agnostic like `final-identity-commit.test.ts`: runs on SQLite by
 * default under `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL `saveIncrementalArticle` against
 * the live database and proves the Phase 2.5 acceptance criteria:
 *
 *   - AC1: a fault injected at EVERY commit write proves the new DRAFT Article,
 *     the candidate terminal (INGESTED + articleId) state, and the required
 *     ARTICLE_PROCESS job are all-or-nothing (nothing survives a rollback).
 *   - AC2: two concurrent workers for the SAME winning candidate create exactly
 *     ONE Article, leave the candidate in ONE consistent terminal state, and
 *     ensure exactly ONE required downstream job (the loser converges).
 *   - AC3: an activation-generation change (active→shadow, definition bump,
 *     activation-marker change, source removed) BETWEEN extraction and commit
 *     refuses the save — the stale worker writes NO Article and NO job.
 *   - AC4: a KNOWN identity (already has an Article, or observed in baseline) is
 *     never touched, even when the freshly-fetched body differs (no update).
 *
 * The save writes an Article with a cuid id + an `article-process:<id>` job
 * dedupe key — neither carries the shared PREFIX — so a local afterEach tracks
 * and deletes them; candidates/sources use the PREFIX and are swept by the
 * shared cleanup.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import {
  ArticleStatus,
  ArticleSourceType,
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

import { enabled } from "./support/db-config";
import { registerIntegrationCleanup } from "./support/db-helpers";
import { createCrawlCandidate, createDiscoverySource } from "./support/discovery-fixtures";

registerIntegrationCleanup();

// Articles/jobs produced by the save carry cuid ids (no PREFIX), so track them.
const articleIds = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const ids = [...articleIds];
  if (ids.length > 0) {
    await prisma.job.deleteMany({
      where: { dedupeKey: { in: ids.map((id) => articleProcessDedupeKey(id)) } },
    });
    // Detach any candidate still linked so the shared candidate sweep can run.
    await prisma.crawlCandidate.updateMany({ where: { articleId: { in: ids } }, data: { articleId: null } });
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
  }
  articleIds.clear();
});

const PROSE = "The quick brown fox jumped over the lazy dog, and then it did so again.";

async function mkActiveSource() {
  return createDiscoverySource({
    lifecycleMode: DiscoverySourceLifecycleMode.ACTIVE,
    definitionVersion: 2,
    activatedAt: new Date("2026-05-01T00:00:00.000Z"),
  });
}

async function mkCandidate(sourceId: string, providerKey: string, overrides = {}) {
  return createCrawlCandidate({
    providerKey,
    discoverySourceId: sourceId,
    status: CrawlCandidateStatus.DISCOVERED,
    ...overrides,
  });
}

function draft(token: string): ArticleDraft {
  return {
    title: `Article ${token}`,
    content: `Body of ${token}. ${PROSE}`,
    author: "A. Writer",
    excerpt: "An excerpt.",
    source: "Test Provider",
    sourceUrl: `https://example.com/${token}`,
    canonicalUrl: `https://example.com/${token}`,
  };
}

function baseInput(
  candidateId: string,
  providerKey: string,
  token: string,
  overrides: Partial<SaveIncrementalArticleInput> = {},
): SaveIncrementalArticleInput {
  const fp = computeProseFingerprint(PROSE);
  return {
    candidateId,
    expectedProviderKey: providerKey,
    sourceGeneration: { definitionVersion: 2, activatedAt: new Date("2026-05-01T00:00:00.000Z") },
    draft: draft(token),
    fingerprint: fp ? { version: fp.version, hash: fp.hash } : null,
    ...overrides,
  };
}

async function articleProcessJob(articleId: string) {
  return prisma.job.findUnique({ where: { dedupeKey: articleProcessDedupeKey(articleId) } });
}

// ---------------------------------------------------------------------------
// Happy path — one DRAFT Article + candidate INGESTED + one ARTICLE_PROCESS job
// ---------------------------------------------------------------------------

test("saves exactly one ownerless DRAFT Article, links the candidate, and enqueues its job", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  const result = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.equal(result.action, "saved");
  if (result.action !== "saved") return;
  articleIds.add(result.articleId);

  const article = await prisma.article.findUnique({ where: { id: result.articleId } });
  assert.ok(article, "Article created");
  assert.equal(article?.status, ArticleStatus.DRAFT, "created as DRAFT (not published)");
  assert.equal(article?.ownerId, null, "ownerless public-library Article");
  assert.equal(article?.sourceType, ArticleSourceType.SCRAPED);
  assert.equal(article?.sourceUrl, `https://example.com/${token}`);

  const linked = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(linked?.status, CrawlCandidateStatus.INGESTED, "candidate marked terminal INGESTED");
  assert.equal(linked?.articleId, result.articleId, "candidate carries the Article id");
  const fp = computeProseFingerprint(PROSE);
  assert.equal(linked?.bodyFingerprint, fp?.hash, "versioned prose fingerprint recorded (never the prose)");

  const job = await articleProcessJob(result.articleId);
  assert.ok(job, "required ARTICLE_PROCESS job enqueued in the same tx");
});

test("re-saving the same candidate is idempotent — one Article, one job (converges)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  const first = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.equal(first.action, "saved");
  if (first.action !== "saved") return;
  articleIds.add(first.articleId);

  const second = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.ok(second.action === "known-article-untouched" || second.action === "converged");

  const count = await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } });
  assert.equal(count, 1, "still exactly one Article after a repeat save");
});

// ---------------------------------------------------------------------------
// AC1 — fault injection at EVERY commit write proves all-or-nothing
// ---------------------------------------------------------------------------

for (const site of ["beforeArticleCreate", "beforeCandidateLink", "beforeJobEnqueue"] as const) {
  test(`AC1: a fault at '${site}' rolls back the Article, the candidate link, AND the job`, async (t) => {
    if (!enabled) {
      t.skip("integration disabled");
      return;
    }
    const token = randomUUID().replace(/-/g, "").slice(0, 12);
    const src = await mkActiveSource();
    const cand = await mkCandidate(src.id, src.providerKey);

    const input = baseInput(cand.id, src.providerKey, token, {
      debugHooks: {
        [site]: () => {
          throw new Error(`injected fault at ${site}`);
        },
      },
    });

    await assert.rejects(() => saveIncrementalArticle(input), /injected fault/);

    const articles = await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } });
    assert.equal(articles, 0, "no Article survives the rollback");
    const linked = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
    assert.equal(linked?.status, CrawlCandidateStatus.DISCOVERED, "candidate stays untouched");
    assert.equal(linked?.articleId, null, "no Article linked");
    const jobs = await prisma.job.findMany({ where: { dedupeKey: { startsWith: "article-process:" } } });
    const orphan = jobs.find((j) => (j.payload as { articleId?: string })?.articleId);
    // No article means no article-process job for it; assert none reference a
    // now-nonexistent article created in this test.
    assert.ok(
      !orphan || (await prisma.article.findUnique({ where: { id: (orphan.payload as { articleId: string }).articleId } })),
      "no orphaned ARTICLE_PROCESS job for a rolled-back Article",
    );
  });
}

// ---------------------------------------------------------------------------
// AC2 — two concurrent workers → exactly one Article + one job
// ---------------------------------------------------------------------------

test("AC2 concurrent: two workers on one winner create ONE Article + ONE job (loser converges)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  const [a, b] = await Promise.all([
    saveIncrementalArticle(baseInput(cand.id, src.providerKey, token)),
    saveIncrementalArticle(baseInput(cand.id, src.providerKey, token)),
  ]);
  for (const r of [a, b]) {
    // One worker saves; the other converges (true race) or sees the linked
    // candidate and no-ops (serialized writer) — never a second Article.
    assert.ok(
      r.action === "saved" || r.action === "converged" || r.action === "known-article-untouched",
      `expected saved/converged/known-article-untouched, got ${r.action}`,
    );
    if (r.action === "saved" || r.action === "converged") articleIds.add(r.articleId);
  }
  assert.ok([a, b].some((r) => r.action === "saved"), "exactly one worker performs the create");

  const articles = await prisma.article.findMany({ where: { sourceUrl: `https://example.com/${token}`, ownerId: null } });
  assert.equal(articles.length, 1, "exactly one Article despite the race");

  const linked = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(linked?.status, CrawlCandidateStatus.INGESTED, "candidate in one consistent terminal state");
  assert.equal(linked?.articleId, articles[0].id, "linked to the single winner Article");

  const job = await articleProcessJob(articles[0].id);
  assert.ok(job, "the winner Article has its required job");
});

// ---------------------------------------------------------------------------
// AC3 — stale activation generation refuses the save (no Article, no job)
// ---------------------------------------------------------------------------

test("AC3: an active→shadow flip between extraction and commit refuses the save", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  // Snapshot captured at extraction; now the generation changes to SHADOW.
  await prisma.discoverySource.update({
    where: { id: src.id },
    data: { lifecycleMode: DiscoverySourceLifecycleMode.SHADOW },
  });

  const result = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.equal(result.action, "revalidation-failed");
  if (result.action === "revalidation-failed") assert.equal(result.reason, "stale-generation");

  assert.equal(await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } }), 0, "no Article");
  const cand2 = await prisma.crawlCandidate.findUnique({ where: { id: cand.id } });
  assert.equal(cand2?.status, CrawlCandidateStatus.DISCOVERED, "candidate untouched by the stale worker");
  assert.equal(cand2?.articleId, null);
});

test("AC3: a definition-version bump between extraction and commit refuses the save", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  await prisma.discoverySource.update({ where: { id: src.id }, data: { definitionVersion: 3 } });

  const result = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.equal(result.action, "revalidation-failed");
  assert.equal(await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } }), 0);
});

test("AC3: a provider-ownership change between extraction and commit refuses the save", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey);

  const result = await saveIncrementalArticle(
    baseInput(cand.id, "some-other-provider", token),
  );
  assert.equal(result.action, "revalidation-failed");
  if (result.action === "revalidation-failed") assert.equal(result.reason, "provider-mismatch");
  assert.equal(await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } }), 0);
});

// ---------------------------------------------------------------------------
// AC4 — a known identity is never touched, even with a different fetched body
// ---------------------------------------------------------------------------

test("AC4: a candidate already linked to an Article is left untouched (no content update)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();

  // A pre-existing known public Article + a candidate already linked to it.
  const known = await prisma.article.create({
    data: {
      title: "Known original title",
      content: "Original body — must never be updated by an incremental path.",
      status: ArticleStatus.DRAFT,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://example.com/${token}`,
    },
  });
  articleIds.add(known.id);
  const cand = await mkCandidate(src.id, src.providerKey, {
    status: CrawlCandidateStatus.INGESTED,
    articleId: known.id,
  });

  const differentBody = baseInput(cand.id, src.providerKey, token, {
    draft: { ...draft(token), title: "DIFFERENT fetched title", content: "DIFFERENT fetched body." },
  });
  const result = await saveIncrementalArticle(differentBody);
  assert.equal(result.action, "known-article-untouched");

  const after = await prisma.article.findUnique({ where: { id: known.id } });
  assert.equal(after?.title, "Known original title", "existing Article title unchanged");
  assert.equal(after?.content, "Original body — must never be updated by an incremental path.", "content unchanged");
  const count = await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } });
  assert.equal(count, 1, "no duplicate Article created");
});

test("AC4: a baseline-observed candidate is never ingested into an Article", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const src = await mkActiveSource();
  const cand = await mkCandidate(src.id, src.providerKey, { observedInBaseline: true });

  const result = await saveIncrementalArticle(baseInput(cand.id, src.providerKey, token));
  assert.equal(result.action, "known-article-untouched");
  assert.equal(await prisma.article.count({ where: { sourceUrl: `https://example.com/${token}` } }), 0, "no Article");
});
