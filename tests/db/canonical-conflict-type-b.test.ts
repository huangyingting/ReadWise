/**
 * First-class runtime (Type B) canonical-conflict resolution integration tests
 * (issue #1135, Phase 3.5).
 *
 * Engine-agnostic like `canonical-conflict-governance.test.ts`: runs on SQLite by
 * default under `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). They exercise the REAL Type-B resolution path against the
 * live database:
 *
 *   - `canonical: "incumbent"` — the incumbent KEEPS its canonical claim + Article;
 *     the parked challenger is folded as a DUPLICATE onto it; the conflict RESOLVES.
 *   - `canonical: "challenger"` — the canonical claim TRANSFERS to the challenger,
 *     the incumbent's aliases fold onto it, and the incumbent's produced Article is
 *     archived + RETAINED (never deleted). DB uniqueness is preserved (AC4).
 *   - Submitting the WRONG selector for the conflict's kind is rejected
 *     `wrong-conflict-type` without mutating state.
 *   - Two concurrent resolutions yield exactly ONE winner + one canonical owner.
 *
 * Every seeded row uses a PREFIX-prefixed providerKey / id so the shared cascade
 * cleanup sweeps candidates, aliases, conflicts, Articles, and jobs.
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
  UrlAliasKind,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveCanonicalConflict } from "@/lib/scraper/incremental/canonical-conflict-commit";
import { TYPE_B_CONFLICT_LOSER_TERMINAL_REASON } from "@/lib/scraper/incremental/canonical-conflict-policy";

import { enabled, PREFIX } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

afterEach(async () => {
  if (!enabled) return;
  // foldLoserInTx cancels candidate ingest jobs keyed on the (PREFIX-prefixed)
  // candidate id, so their dedupeKey CONTAINS but does not START with PREFIX.
  await prisma.job.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
});

type TypeBSeed = {
  providerKey: string;
  conflictId: string;
  incumbentId: string;
  challengerId: string;
  incumbentArticleId: string | null;
  canonicalKey: string;
  challengerKey: string;
};

/**
 * Seeds an OPEN runtime (Type B) conflict: an incumbent candidate that owns the
 * canonical slot (+ optionally a produced Article + a CANONICAL alias) and a parked
 * NEEDS_REVIEW challenger candidate (+ its PROVISIONAL alias), plus the
 * `CanonicalConflict` linking them via `incumbentCandidateId`.
 */
async function seedTypeBConflict(opts: { withIncumbentArticle?: boolean } = {}): Promise<TypeBSeed> {
  const withIncumbentArticle = opts.withIncumbentArticle ?? true;
  const providerKey = id("prov");
  const token = randomUUID().replace(/-/g, "").slice(0, 10);
  const canonicalKey = `1:canon_${token}`;
  const challengerKey = `1:chal_${token}`;

  let incumbentArticleId: string | null = null;
  if (withIncumbentArticle) {
    incumbentArticleId = id("article");
    await prisma.article.create({
      data: {
        id: incumbentArticleId,
        title: "Type-B incumbent fixture",
        content: "Representative incumbent body for Type-B conflict tests.",
        status: ArticleStatus.PUBLISHED,
        visibility: ArticleVisibility.PUBLIC,
        sourceType: ArticleSourceType.SCRAPED,
        ownerId: null,
        sourceUrl: `https://example.test/${token}`,
        takedownState: "active",
        publishedAt: new Date(),
      },
    });
  }

  const incumbentId = id("candinc");
  await prisma.crawlCandidate.create({
    data: {
      id: incumbentId,
      providerKey,
      identityVersion: 1,
      provisionalKey: canonicalKey,
      canonicalKey,
      status: CrawlCandidateStatus.INGESTED,
      observedInBaseline: false,
      articleId: incumbentArticleId,
    },
  });
  await prisma.urlAlias.create({
    data: {
      candidateId: incumbentId,
      providerKey,
      identityVersion: 1,
      aliasKey: canonicalKey,
      kind: UrlAliasKind.CANONICAL,
    },
  });

  const challengerId = id("candchal");
  await prisma.crawlCandidate.create({
    data: {
      id: challengerId,
      providerKey,
      identityVersion: 1,
      provisionalKey: challengerKey,
      canonicalKey: null,
      status: CrawlCandidateStatus.NEEDS_REVIEW,
      observedInBaseline: false,
      articleId: null,
      terminalReason: "final-identity:cross-provider-prose-fingerprint",
    },
  });
  await prisma.urlAlias.create({
    data: {
      candidateId: challengerId,
      providerKey,
      identityVersion: 1,
      aliasKey: challengerKey,
      kind: UrlAliasKind.PROVISIONAL,
    },
  });

  const conflict = await prisma.canonicalConflict.create({
    data: {
      providerKey,
      identityVersion: 1,
      canonicalKey,
      challengerKey,
      incumbentCandidateId: incumbentId,
      status: CanonicalConflictStatus.OPEN,
      reason: "final-identity:cross-provider-prose-fingerprint:v1",
    },
    select: { id: true },
  });

  return { providerKey, conflictId: conflict.id, incumbentId, challengerId, incumbentArticleId, canonicalKey, challengerKey };
}

// ---------------------------------------------------------------------------
// canonical: "incumbent" — incumbent kept, challenger folded, conflict RESOLVED
// ---------------------------------------------------------------------------

test("Type-B incumbent: challenger is folded DUPLICATE, incumbent keeps its claim + Article", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();

  const outcome = await resolveCanonicalConflict({
    conflictId: seed.conflictId,
    canonical: "incumbent",
    resolvedBy: "op-incumbent",
  });
  assert.ok(outcome.ok && outcome.kind === "applied-type-b", `applied, got ${JSON.stringify(outcome)}`);
  if (outcome.ok && outcome.kind === "applied-type-b") {
    assert.equal(outcome.canonical, "incumbent");
    assert.equal(outcome.winnerCandidateId, seed.incumbentId);
    assert.equal(outcome.loserCandidateId, seed.challengerId);
    assert.equal(outcome.archivedArticleId, null);
  }

  // Incumbent keeps its canonical claim + Article, untouched.
  const incumbent = await prisma.crawlCandidate.findUnique({ where: { id: seed.incumbentId } });
  assert.equal(incumbent?.canonicalKey, seed.canonicalKey);
  assert.equal(incumbent?.status, CrawlCandidateStatus.INGESTED);
  assert.equal(incumbent?.articleId, seed.incumbentArticleId);

  // Challenger folded DUPLICATE_ALIAS onto the incumbent.
  const challenger = await prisma.crawlCandidate.findUnique({ where: { id: seed.challengerId } });
  assert.equal(challenger?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(challenger?.canonicalKey, null);
  assert.equal(challenger?.terminalReason, TYPE_B_CONFLICT_LOSER_TERMINAL_REASON);

  // The challenger's alias re-points to the incumbent, relabelled DUPLICATE.
  const challengerAlias = await prisma.urlAlias.findUnique({
    where: {
      providerKey_identityVersion_aliasKey: { providerKey: seed.providerKey, identityVersion: 1, aliasKey: seed.challengerKey },
    },
  });
  assert.equal(challengerAlias?.candidateId, seed.incumbentId);
  assert.equal(challengerAlias?.kind, UrlAliasKind.DUPLICATE);

  // The incumbent's Article is NOT archived.
  const article = await prisma.article.findUnique({ where: { id: seed.incumbentArticleId! } });
  assert.equal(article?.takedownState, "active");
  assert.equal(article?.status, ArticleStatus.PUBLISHED);

  // The conflict is RESOLVED.
  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: seed.conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.RESOLVED);
  assert.equal(conflict?.resolvedBy, "op-incumbent");

  // Exactly one candidate owns the canonical slot (still the incumbent).
  const owners = await prisma.crawlCandidate.count({ where: { providerKey: seed.providerKey, canonicalKey: seed.canonicalKey } });
  assert.equal(owners, 1);
});

// ---------------------------------------------------------------------------
// canonical: "challenger" — claim transferred, incumbent folded + archived
// ---------------------------------------------------------------------------

test("Type-B challenger: canonical claim transfers, incumbent aliases fold, incumbent Article archived + retained (AC4 uniqueness)", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();

  const outcome = await resolveCanonicalConflict({
    conflictId: seed.conflictId,
    canonical: "challenger",
    resolvedBy: "op-challenger",
  });
  assert.ok(outcome.ok && outcome.kind === "applied-type-b", `applied, got ${JSON.stringify(outcome)}`);
  if (outcome.ok && outcome.kind === "applied-type-b") {
    assert.equal(outcome.canonical, "challenger");
    assert.equal(outcome.winnerCandidateId, seed.challengerId);
    assert.equal(outcome.loserCandidateId, seed.incumbentId);
    assert.equal(outcome.archivedArticleId, seed.incumbentArticleId);
  }

  // The challenger now owns the canonical claim + returns to the normal pipeline.
  const challenger = await prisma.crawlCandidate.findUnique({ where: { id: seed.challengerId } });
  assert.equal(challenger?.canonicalKey, seed.canonicalKey);
  assert.equal(challenger?.status, CrawlCandidateStatus.DISCOVERED);
  assert.equal(challenger?.terminalReason, null);

  // The incumbent is folded: its canonical slot is cleared, it is DUPLICATE_ALIAS.
  const incumbent = await prisma.crawlCandidate.findUnique({ where: { id: seed.incumbentId } });
  assert.equal(incumbent?.canonicalKey, null);
  assert.equal(incumbent?.status, CrawlCandidateStatus.DUPLICATE_ALIAS);
  assert.equal(incumbent?.terminalReason, TYPE_B_CONFLICT_LOSER_TERMINAL_REASON);

  // The CANONICAL alias is now owned by the challenger.
  const canonicalAlias = await prisma.urlAlias.findUnique({
    where: {
      providerKey_identityVersion_aliasKey: { providerKey: seed.providerKey, identityVersion: 1, aliasKey: seed.canonicalKey },
    },
  });
  assert.equal(canonicalAlias?.candidateId, seed.challengerId);
  assert.equal(canonicalAlias?.kind, UrlAliasKind.CANONICAL);

  // The incumbent's Article is archived out of public feeds — RETAINED, never deleted.
  const article = await prisma.article.findUnique({ where: { id: seed.incumbentArticleId! } });
  assert.ok(article, "incumbent Article retained (not deleted)");
  assert.equal(article?.takedownState, "archived");
  assert.equal(article?.status, ArticleStatus.DRAFT);
  const reviews = await prisma.contentReview.count({ where: { articleId: seed.incumbentArticleId! } });
  assert.ok(reviews >= 1, "a ContentReview audit row records the archive");

  // AC4: DB uniqueness preserved — exactly ONE candidate owns the canonical slot.
  const owners = await prisma.crawlCandidate.count({ where: { providerKey: seed.providerKey, canonicalKey: seed.canonicalKey } });
  assert.equal(owners, 1, "exactly one canonical owner after the transfer");

  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: seed.conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.RESOLVED);
});

test("Type-B challenger: promotion works when the incumbent produced NO Article (nothing to archive)", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict({ withIncumbentArticle: false });

  const outcome = await resolveCanonicalConflict({
    conflictId: seed.conflictId,
    canonical: "challenger",
    resolvedBy: "op-challenger-noart",
  });
  assert.ok(outcome.ok && outcome.kind === "applied-type-b", `applied, got ${JSON.stringify(outcome)}`);
  if (outcome.ok && outcome.kind === "applied-type-b") {
    assert.equal(outcome.archivedArticleId, null);
  }

  const challenger = await prisma.crawlCandidate.findUnique({ where: { id: seed.challengerId } });
  assert.equal(challenger?.canonicalKey, seed.canonicalKey);
  const owners = await prisma.crawlCandidate.count({ where: { providerKey: seed.providerKey, canonicalKey: seed.canonicalKey } });
  assert.equal(owners, 1);
});

// ---------------------------------------------------------------------------
// Wrong selector for the conflict's kind → rejected without mutating state
// ---------------------------------------------------------------------------

test("Type-B conflict rejects a Type-A selector (survivingArticleId) as wrong-conflict-type", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();

  const outcome = await resolveCanonicalConflict({
    conflictId: seed.conflictId,
    survivingArticleId: seed.incumbentArticleId ?? "whatever",
    resolvedBy: "op-wrong",
  });
  assert.ok(!outcome.ok && outcome.reason === "illegal", `illegal, got ${JSON.stringify(outcome)}`);
  if (!outcome.ok && outcome.reason === "illegal") {
    assert.equal(outcome.illegal, "wrong-conflict-type");
  }

  // The conflict is UNCHANGED (still OPEN, still Type-B).
  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: seed.conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.OPEN);
  const incumbent = await prisma.crawlCandidate.findUnique({ where: { id: seed.incumbentId } });
  assert.equal(incumbent?.canonicalKey, seed.canonicalKey);
});

test("Type-A conflict rejects a Type-B selector (canonical) as wrong-conflict-type", { skip: !enabled }, async () => {
  // A baseline (Type A) conflict has no incumbentCandidateId.
  const providerKey = id("prov");
  const token = randomUUID().replace(/-/g, "").slice(0, 10);
  const canonicalKey = `1:canon_${token}`;
  const conflict = await prisma.canonicalConflict.create({
    data: {
      providerKey,
      identityVersion: 1,
      canonicalKey,
      challengerKey: canonicalKey,
      incumbentCandidateId: null,
      status: CanonicalConflictStatus.OPEN,
    },
    select: { id: true },
  });

  const outcome = await resolveCanonicalConflict({
    conflictId: conflict.id,
    canonical: "incumbent",
    resolvedBy: "op-wrong-a",
  });
  assert.ok(!outcome.ok && outcome.reason === "illegal", `illegal, got ${JSON.stringify(outcome)}`);
  if (!outcome.ok && outcome.reason === "illegal") {
    assert.equal(outcome.illegal, "wrong-conflict-type");
  }
  const after = await prisma.canonicalConflict.findUnique({ where: { id: conflict.id } });
  assert.equal(after?.status, CanonicalConflictStatus.OPEN);
});

test("Type-B challenger promotion is illegal when the parked challenger no longer exists", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();
  // The challenger candidate vanished (e.g. a concurrent delete).
  await prisma.urlAlias.deleteMany({ where: { candidateId: seed.challengerId } });
  await prisma.crawlCandidate.delete({ where: { id: seed.challengerId } });

  const outcome = await resolveCanonicalConflict({
    conflictId: seed.conflictId,
    canonical: "challenger",
    resolvedBy: "op-missing",
  });
  assert.ok(!outcome.ok && outcome.reason === "illegal", `illegal, got ${JSON.stringify(outcome)}`);
  if (!outcome.ok && outcome.reason === "illegal") {
    assert.equal(outcome.illegal, "challenger-candidate-missing");
  }
  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: seed.conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.OPEN);
});

// ---------------------------------------------------------------------------
// Idempotency + AC4 concurrency
// ---------------------------------------------------------------------------

test("Type-B: re-resolving an already-RESOLVED conflict is an idempotent no-op", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();
  const first = await resolveCanonicalConflict({ conflictId: seed.conflictId, canonical: "incumbent", resolvedBy: "op-1" });
  assert.ok(first.ok && first.kind === "applied-type-b");

  const second = await resolveCanonicalConflict({ conflictId: seed.conflictId, canonical: "incumbent", resolvedBy: "op-2" });
  assert.ok(second.ok && second.kind === "noop", `noop, got ${JSON.stringify(second)}`);
  if (second.ok && second.kind === "noop") {
    assert.equal(second.reason, "already-resolved");
  }
});

test("AC4: two concurrent Type-B resolutions yield exactly one winner + one canonical owner", { skip: !enabled }, async () => {
  const seed = await seedTypeBConflict();

  const [a, b] = await Promise.all([
    resolveCanonicalConflict({ conflictId: seed.conflictId, canonical: "challenger", resolvedBy: "op-a" }),
    resolveCanonicalConflict({ conflictId: seed.conflictId, canonical: "challenger", resolvedBy: "op-b" }),
  ]);

  const applied = [a, b].filter((r) => r.ok && r.kind === "applied-type-b");
  assert.equal(applied.length, 1, "exactly one resolver applies the change");
  for (const r of [a, b]) {
    assert.ok(
      (r.ok && (r.kind === "applied-type-b" || r.kind === "noop")) || (!r.ok && r.reason === "stale"),
      `safe outcome, got ${JSON.stringify(r)}`,
    );
  }

  const owners = await prisma.crawlCandidate.count({ where: { providerKey: seed.providerKey, canonicalKey: seed.canonicalKey } });
  assert.equal(owners, 1, "database uniqueness preserved: exactly one canonical owner");

  const conflict = await prisma.canonicalConflict.findUnique({ where: { id: seed.conflictId } });
  assert.equal(conflict?.status, CanonicalConflictStatus.RESOLVED);
});
