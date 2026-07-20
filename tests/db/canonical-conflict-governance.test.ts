/**
 * Canonical-conflict + deletion-governance integration tests (#1104, Phase 3.5).
 *
 * Engine-agnostic like `discovery-ledger.test.ts` / `baseline-backfill.test.ts`:
 * runs on SQLite by default under `npm run test:db`, PostgreSQL in CI, guarded by
 * `enabled` (RUN_DB_INTEGRATION=1). They exercise the REAL resolution / deletion /
 * recovery paths against the live database:
 *
 *   - AC1: resolving one conflict yields exactly ONE public identity owner,
 *     PRESERVES the losers' dependent reader data (archive, never delete), and
 *     removes ONLY that conflict block.
 *   - AC2: deleting an Article stamps the producing candidate with a permanent
 *     DELETED terminal (never re-created by discovery/backfill); explicit recovery
 *     re-admits it for re-ingestion and enqueues one ingest Job.
 *   - AC3: a withdrawal/takedown changes library visibility/state WITHOUT erasing
 *     the candidate ledger or content-review history.
 *   - AC4: concurrent resolution / recovery attempts fail safely and preserve
 *     database uniqueness (exactly one owner, exactly one job).
 *
 * Conflict/candidate/alias rows created via the real backfill carry REAL provider
 * keys (e.g. "undark") so the shared PREFIX sweep cannot reach them; a local
 * afterEach deletes the exact identity keys + recovery jobs produced here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import {
  ArticleSourceType,
  ArticleStatus,
  ArticleVisibility,
  CanonicalConflictStatus,
  CrawlCandidateStatus,
  JobType,
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { candidateIngestDedupeKey } from "@/lib/jobs";
import { backfillDiscoveryBaseline } from "@/lib/scraper/incremental/baseline-backfill";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";
import { resolveCanonicalConflict } from "@/lib/scraper/incremental/canonical-conflict-commit";
import {
  getCanonicalConflict,
  listCanonicalConflicts,
} from "@/lib/scraper/incremental/canonical-conflict-query";
import {
  ARTICLE_DELETED_TERMINAL_REASON,
  CONFLICT_SURVIVOR_TERMINAL_REASON,
} from "@/lib/scraper/incremental/canonical-conflict-policy";
import {
  listDeletedCandidates,
  recoverDeletedCandidate,
} from "@/lib/scraper/incremental/deleted-article-recovery";
import { applyTakedown, deleteArticle } from "@/lib/article-library";

import { enabled, PREFIX } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

// Identity keys produced under REAL provider keys (backfill/resolution) — the
// shared PREFIX sweep cannot reach them, so track + delete them locally.
const createdIdentityKeys = new Set<string>();

afterEach(async () => {
  if (!enabled) return;
  const keys = [...createdIdentityKeys];
  if (keys.length > 0) {
    await prisma.urlAlias.deleteMany({ where: { aliasKey: { in: keys } } });
    await prisma.crawlCandidate.deleteMany({ where: { provisionalKey: { in: keys } } });
    await prisma.crawlCandidate.deleteMany({ where: { canonicalKey: { in: keys } } });
    await prisma.canonicalConflict.deleteMany({ where: { canonicalKey: { in: keys } } });
  }
  createdIdentityKeys.clear();
  // Recovery/ingest jobs are keyed on the (PREFIX-prefixed) candidate id, so the
  // dedupeKey contains PREFIX even though it does not start with it.
  await prisma.job.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
});

/** A unique undark.org URL (real provider → non-null identity key). */
function undarkUrl(token: string, query = ""): string {
  return `https://undark.org/2024/06/15/${token}-story/${query}`;
}

async function createPublicScrapedArticle(
  sourceUrl: string,
  status: ArticleStatus = ArticleStatus.PUBLISHED,
): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Governance fixture",
      content: "Representative body for conflict-governance tests.",
      status,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl,
      takedownState: "active",
      publishedAt: new Date(),
    },
  });
  createdIdentityKeys.add(deriveProvisionalIdentity(sourceUrl).key);
  return articleId;
}

async function createUser(): Promise<string> {
  const userId = id("user");
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.com` } });
  return userId;
}

/** Seeds an OPEN baseline conflict from two colliding public Articles. */
async function seedConflict(token: string): Promise<{
  conflictId: string;
  identityKey: string;
  survivorId: string;
  loserId: string;
}> {
  const survivorId = await createPublicScrapedArticle(undarkUrl(token));
  const loserId = await createPublicScrapedArticle(undarkUrl(token, "?utm_source=newsletter"));

  const report = await backfillDiscoveryBaseline({ articleIds: [survivorId, loserId] });
  assert.equal(report.conflictsCreated, 1, "backfill created exactly one conflict");

  const identityKey = deriveProvisionalIdentity(undarkUrl(token)).key;
  const conflict = await prisma.canonicalConflict.findUnique({
    where: {
      providerKey_identityVersion_canonicalKey: {
        providerKey: "undark",
        identityVersion: 1,
        canonicalKey: identityKey,
      },
    },
    select: { id: true },
  });
  assert.ok(conflict, "the OPEN conflict exists");
  return { conflictId: conflict.id, identityKey, survivorId, loserId };
}

// ---------------------------------------------------------------------------
// AC1 — resolve → exactly one owner, dependent data preserved, only that block
// ---------------------------------------------------------------------------

test("AC1: resolving a conflict yields one identity owner, preserves loser data, removes only that block", { skip: !enabled }, async () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const { conflictId, identityKey, survivorId, loserId } = await seedConflict(token);

  // An UNRELATED open conflict that must remain untouched.
  const otherToken = randomUUID().replace(/-/g, "").slice(0, 12);
  const other = await seedConflict(otherToken);

  // Reader/learning data on the loser — must survive the resolution.
  const reader = await createUser();
  await prisma.highlight.create({
    data: { userId: reader, articleId: loserId, quote: "x", startOffset: 0, endOffset: 1 },
  });
  await prisma.readingProgress.create({
    data: { userId: reader, articleId: loserId, percent: 42 },
  });

  // The queue exposes the loser's dependent-data COUNTS before resolution.
  const detail = await getCanonicalConflict(conflictId);
  assert.ok(detail, "detail DTO exists");
  assert.deepEqual([...detail.conflictingArticleIds].sort(), [survivorId, loserId].sort());
  assert.equal(detail.dependentData.highlights, 1);
  assert.equal(detail.dependentData.readingProgress, 1);

  const outcome = await resolveCanonicalConflict({
    conflictId,
    survivingArticleId: survivorId,
    resolvedBy: reader,
  });
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.deepEqual(outcome.loserArticleIds, [loserId]);
  }

  // Exactly ONE candidate owns the canonical public identity, linked to survivor.
  const owners = await prisma.crawlCandidate.findMany({
    where: { providerKey: "undark", canonicalKey: identityKey },
  });
  assert.equal(owners.length, 1, "exactly one public identity owner");
  assert.equal(owners[0].articleId, survivorId, "owner links the survivor Article");
  assert.equal(owners[0].status, CrawlCandidateStatus.INGESTED);
  assert.equal(owners[0].observedInBaseline, true, "known baseline identity (never auto-reingested)");
  assert.equal(owners[0].terminalReason, CONFLICT_SURVIVOR_TERMINAL_REASON);

  // A CANONICAL alias is attached to the survivor identity.
  const alias = await prisma.urlAlias.findUnique({
    where: {
      providerKey_identityVersion_aliasKey: { providerKey: "undark", identityVersion: 1, aliasKey: identityKey },
    },
  });
  assert.equal(alias?.kind, UrlAliasKind.CANONICAL);
  assert.equal(alias?.candidateId, owners[0].id);

  // Loser is ARCHIVED out of public feeds but NOT deleted; its data is preserved.
  const loser = await prisma.article.findUnique({ where: { id: loserId } });
  assert.ok(loser, "loser Article still exists (retained, not deleted)");
  assert.equal(loser?.takedownState, "archived");
  assert.equal(loser?.status, ArticleStatus.DRAFT, "PUBLISHED loser forced to DRAFT");
  assert.equal(
    await prisma.highlight.count({ where: { articleId: loserId } }),
    1,
    "loser highlight preserved",
  );
  assert.equal(
    await prisma.readingProgress.count({ where: { articleId: loserId } }),
    1,
    "loser reading progress preserved",
  );
  const review = await prisma.contentReview.findFirst({ where: { articleId: loserId } });
  assert.ok(review, "an archival content-review row was recorded");

  // ONLY that block is removed: this conflict RESOLVED, the unrelated one still OPEN.
  const resolved = await prisma.canonicalConflict.findUnique({ where: { id: conflictId } });
  assert.equal(resolved?.status, CanonicalConflictStatus.RESOLVED);
  assert.equal(resolved?.resolvedBy, reader);
  const untouched = await prisma.canonicalConflict.findUnique({ where: { id: other.conflictId } });
  assert.equal(untouched?.status, CanonicalConflictStatus.OPEN, "unrelated conflict remains OPEN");
});

test("AC1 idempotent: re-resolving an already-resolved conflict is a no-op", { skip: !enabled }, async () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const { conflictId, survivorId } = await seedConflict(token);
  const operator = await createUser();

  const first = await resolveCanonicalConflict({ conflictId, survivingArticleId: survivorId, resolvedBy: operator });
  assert.ok(first.ok && first.kind === "applied");

  const second = await resolveCanonicalConflict({ conflictId, survivingArticleId: survivorId, resolvedBy: operator });
  assert.ok(second.ok && second.kind === "noop");
  if (second.ok && second.kind === "noop") {
    assert.equal(second.reason, "already-resolved");
  }
});

test("AC1 guard: choosing a non-participant survivor is rejected without mutating state", { skip: !enabled }, async () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const { conflictId, identityKey } = await seedConflict(token);
  const stranger = await createPublicScrapedArticle(undarkUrl(`${token}-stranger`));
  const operator = await createUser();

  const outcome = await resolveCanonicalConflict({
    conflictId,
    survivingArticleId: stranger,
    resolvedBy: operator,
  });
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok && outcome.reason === "illegal");
  if (!outcome.ok && outcome.reason === "illegal") {
    assert.equal(outcome.illegal, "survivor-not-a-participant");
  }

  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.OPEN, "conflict is untouched");
  assert.equal(
    await prisma.crawlCandidate.count({ where: { providerKey: "undark", canonicalKey: identityKey } }),
    0,
    "no identity owner was claimed",
  );
});

// ---------------------------------------------------------------------------
// AC2 — delete stamps a permanent DELETED terminal; explicit recovery re-admits
// ---------------------------------------------------------------------------

async function createIngestedCandidateForArticle(articleId: string): Promise<string> {
  const provider = id("provider");
  const candidate = await prisma.crawlCandidate.create({
    data: {
      id: id("crawl_candidate"),
      providerKey: provider,
      identityVersion: 1,
      provisionalKey: id("provisional"),
      canonicalKey: id("canonical"),
      status: CrawlCandidateStatus.INGESTED,
      observedInBaseline: false,
      articleId,
      ingestedAt: new Date(),
      extractorVersion: 3,
    },
    select: { id: true },
  });
  return candidate.id;
}

test("AC2: deleting an Article stamps the producing candidate DELETED; discovery cannot recreate it", { skip: !enabled }, async () => {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "To be deleted",
      content: "body",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://undark.org/2024/06/15/${randomUUID().slice(0, 8)}-del/`,
    },
  });
  const candidateId = await createIngestedCandidateForArticle(articleId);

  const deleted = await deleteArticle(articleId);
  assert.equal(deleted, true);

  assert.equal(await prisma.article.findUnique({ where: { id: articleId } }), null, "article is gone");

  const candidate = await prisma.crawlCandidate.findUnique({ where: { id: candidateId } });
  assert.ok(candidate, "the producing candidate SURVIVES the delete (deletion-safe ledger)");
  assert.equal(candidate?.articleId, null, "articleId is SetNull");
  assert.ok(candidate?.articleDeletedAt, "articleDeletedAt is stamped");
  assert.equal(candidate?.terminalReason, ARTICLE_DELETED_TERMINAL_REASON);
  assert.ok(candidate?.terminalAt, "terminalAt is stamped");

  // The deleted identity shows up in the recovery queue.
  const page = await listDeletedCandidates({ providerKey: candidate!.providerKey });
  assert.equal(page.total, 1);
  assert.equal(page.candidates[0]?.id, candidateId);
});

test("AC2: explicit recovery re-admits a deleted identity and enqueues one ingest job", { skip: !enabled }, async () => {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Recoverable",
      content: "body",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://undark.org/2024/06/15/${randomUUID().slice(0, 8)}-rec/`,
    },
  });
  const candidateId = await createIngestedCandidateForArticle(articleId);
  await deleteArticle(articleId);

  const outcome = await recoverDeletedCandidate(candidateId);
  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);

  const candidate = await prisma.crawlCandidate.findUnique({ where: { id: candidateId } });
  assert.equal(candidate?.status, CrawlCandidateStatus.DISCOVERED, "re-admitted as runnable");
  assert.equal(candidate?.articleDeletedAt, null, "deleted terminal cleared");
  assert.equal(candidate?.terminalReason, null);
  assert.equal(candidate?.extractorVersion, 4, "extractor version bumped for a fresh ingest dedupe key");

  if (outcome.ok) {
    const job = await prisma.job.findUnique({ where: { dedupeKey: outcome.dedupeKey } });
    assert.ok(job, "a fresh ARTICLE_INGEST job was enqueued");
    assert.equal(job?.type, JobType.ARTICLE_INGEST);
    assert.equal(job?.id, outcome.jobId);
    assert.equal(outcome.dedupeKey, candidateIngestDedupeKey(candidateId, 4));
  }
});

test("AC2 guard: a live (non-deleted) candidate cannot be recovered", { skip: !enabled }, async () => {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Live",
      content: "body",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://undark.org/2024/06/15/${randomUUID().slice(0, 8)}-live/`,
    },
  });
  const candidateId = await createIngestedCandidateForArticle(articleId);

  const outcome = await recoverDeletedCandidate(candidateId);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok && outcome.reason === "ineligible");
});

// ---------------------------------------------------------------------------
// AC3 — withdrawal/takedown changes visibility WITHOUT erasing ledger/review
// ---------------------------------------------------------------------------

test("AC3: takedown changes state without erasing candidate or review history", { skip: !enabled }, async () => {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Governed",
      content: "body",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://undark.org/2024/06/15/${randomUUID().slice(0, 8)}-gov/`,
    },
  });
  const candidateId = await createIngestedCandidateForArticle(articleId);
  const reviewer = await createUser();

  const result = await applyTakedown({ articleId, state: "unpublished", reviewerId: reviewer });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.state, "unpublished");
    assert.equal(result.status, ArticleStatus.DRAFT, "non-active state forces DRAFT out of public feeds");
  }

  // The candidate ledger + its terminal history are entirely preserved.
  const candidate = await prisma.crawlCandidate.findUnique({ where: { id: candidateId } });
  assert.ok(candidate, "candidate is NOT erased by governance");
  assert.equal(candidate?.articleId, articleId, "candidate still links the (non-deleted) article");
  assert.equal(candidate?.status, CrawlCandidateStatus.INGESTED, "candidate status unchanged");
  assert.equal(candidate?.articleDeletedAt, null, "governance is NOT a deletion");

  // The article still exists (soft state), so review history is retained.
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  assert.equal(article?.takedownState, "unpublished");
  assert.equal(article?.visibility, ArticleVisibility.PUBLIC, "visibility column unchanged; DRAFT status gates the feed");
});

// ---------------------------------------------------------------------------
// AC4 — concurrent resolution / recovery fail safely + preserve uniqueness
// ---------------------------------------------------------------------------

test("AC4: two concurrent resolutions yield exactly one owner (the loser converges to a no-op)", { skip: !enabled }, async () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const { conflictId, identityKey, survivorId } = await seedConflict(token);
  const operator = await createUser();

  const [a, b] = await Promise.all([
    resolveCanonicalConflict({ conflictId, survivingArticleId: survivorId, resolvedBy: operator }),
    resolveCanonicalConflict({ conflictId, survivingArticleId: survivorId, resolvedBy: operator }),
  ]);

  const applied = [a, b].filter((r) => r.ok && r.kind === "applied");
  assert.equal(applied.length, 1, "exactly one resolver applies the change");
  for (const r of [a, b]) {
    assert.ok(
      (r.ok && (r.kind === "applied" || r.kind === "noop")) || (!r.ok && r.reason === "stale"),
      `safe outcome, got ${JSON.stringify(r)}`,
    );
  }

  const owners = await prisma.crawlCandidate.count({ where: { providerKey: "undark", canonicalKey: identityKey } });
  assert.equal(owners, 1, "database uniqueness preserved: exactly one identity owner");

  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.RESOLVED);
});

test("AC4: two concurrent recoveries yield exactly one re-admission + one job", { skip: !enabled }, async () => {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Race recover",
      content: "body",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      sourceType: ArticleSourceType.SCRAPED,
      ownerId: null,
      sourceUrl: `https://undark.org/2024/06/15/${randomUUID().slice(0, 8)}-race/`,
    },
  });
  const candidateId = await createIngestedCandidateForArticle(articleId);
  await deleteArticle(articleId);

  const [a, b] = await Promise.all([
    recoverDeletedCandidate(candidateId),
    recoverDeletedCandidate(candidateId),
  ]);

  const ok = [a, b].filter((r) => r.ok);
  assert.equal(ok.length, 1, "exactly one recovery succeeds");
  const failed = [a, b].find((r) => !r.ok);
  assert.ok(failed && !failed.ok && (failed.reason === "conflict" || failed.reason === "ineligible"));

  const jobs = await prisma.job.count({
    where: { type: JobType.ARTICLE_INGEST, dedupeKey: { contains: candidateId } },
  });
  assert.equal(jobs, 1, "exactly one ingest job despite the race");
});

// Also exercised elsewhere: listing surfaces sanitized DTOs only.
test("query: listCanonicalConflicts returns sanitized OPEN conflicts with counts", { skip: !enabled }, async () => {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const { identityKey } = await seedConflict(token);

  const page = await listCanonicalConflicts({ providerKey: "undark" });
  const row = page.conflicts.find((c) => c.canonicalKey === identityKey);
  assert.ok(row, "the seeded conflict is listed");
  assert.equal(row?.status, CanonicalConflictStatus.OPEN);
  assert.equal(row?.conflictingArticleIds.length, 2, "both contested Article ids are exposed");
  assert.ok(!("sourceUrl" in (row as object)), "no URL is present in the DTO");
});
