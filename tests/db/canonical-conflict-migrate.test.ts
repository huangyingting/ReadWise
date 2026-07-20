/**
 * OPT-IN reader/learning-data migration on canonical-conflict resolution
 * (issue #1134, Phase 3.5 follow-up to #1104).
 *
 * Engine-agnostic like `canonical-conflict-governance.test.ts`: runs on SQLite by
 * default under `npm run test:db`, PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL guarded resolution transaction with
 * `migrateReaderData: true` against the live database and proves the documented
 * per-model collision rules, the highlight re-anchor/skip behavior, atomicity, and
 * that the DEFAULT (flag off) preserves #1104's retain-on-loser behavior.
 *
 * Reader text is derived by an INJECTED identity function so the seeded plain-text
 * `content` IS the offset space (no `@/lib/content-pipeline` dependency in tests).
 *
 * Conflict/candidate/alias rows carry REAL provider keys ("undark") the shared
 * PREFIX sweep cannot reach; a local afterEach deletes the exact identity keys.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { ArticleSourceType, ArticleStatus, ArticleVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { backfillDiscoveryBaseline } from "@/lib/scraper/incremental/baseline-backfill";
import { resolveCanonicalConflict } from "@/lib/scraper/incremental/canonical-conflict-commit";
import { deriveProvisionalIdentity } from "@/lib/scraper/url-identity";

import { enabled, PREFIX } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

/** Injected identity deriver — the seeded plain-text content is the offset space. */
const deriveReaderText = (content: string): string => content;

/** "The quick brown fox jumps over the lazy dog." — "brown fox" occupies [10, 19). */
const SURVIVOR_TEXT = "The quick brown fox jumps over the lazy dog.";
const FOX_START = 10;
const FOX_END = 19;

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
  await prisma.job.deleteMany({ where: { dedupeKey: { contains: PREFIX } } });
});

function undarkUrl(token: string, query = ""): string {
  return `https://undark.org/2024/06/15/${token}-story/${query}`;
}

async function createPublicScrapedArticle(sourceUrl: string, content: string): Promise<string> {
  const articleId = id("article");
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Migration fixture",
      content,
      status: ArticleStatus.PUBLISHED,
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
async function seedConflict(
  survivorContent = "survivor body",
  loserContent = "loser body",
): Promise<{ conflictId: string; survivorId: string; loserId: string }> {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  const survivorId = await createPublicScrapedArticle(undarkUrl(token), survivorContent);
  const loserId = await createPublicScrapedArticle(
    undarkUrl(token, "?utm_source=newsletter"),
    loserContent,
  );

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
  return { conflictId: conflict.id, survivorId, loserId };
}

async function resolve(conflictId: string, survivorId: string, migrateReaderData: boolean) {
  return resolveCanonicalConflict(
    { conflictId, survivingArticleId: survivorId, resolvedBy: "operator", migrateReaderData },
    { deriveReaderText },
  );
}

// ---------------------------------------------------------------------------
// Default (flag off) preserves #1104 retain-on-loser behavior byte-for-byte.
// ---------------------------------------------------------------------------

test("default (migrateReaderData off) retains all reader data on the loser", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.readingProgress.create({ data: { userId: reader, articleId: loserId, percent: 42 } });
  await prisma.highlight.create({
    data: { userId: reader, articleId: loserId, quote: "x", startOffset: 0, endOffset: 1 },
  });

  const outcome = await resolve(conflictId, survivorId, false);
  assert.ok(outcome.ok && outcome.kind === "applied");
  assert.equal(outcome.ok && outcome.kind === "applied" && outcome.migration, undefined, "no migration summary");

  assert.equal(await prisma.readingProgress.count({ where: { articleId: loserId } }), 1, "RP retained on loser");
  assert.equal(await prisma.readingProgress.count({ where: { articleId: survivorId } }), 0, "survivor untouched");
  assert.equal(await prisma.highlight.count({ where: { articleId: loserId } }), 1, "highlight retained on loser");
});

// ---------------------------------------------------------------------------
// No-collision repoint (unique + append-only models).
// ---------------------------------------------------------------------------

test("opt-in migration repoints loser data onto the survivor when there is no collision", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.readingProgress.create({ data: { userId: reader, articleId: loserId, percent: 55, completed: false } });
  await prisma.tutorMessage.create({ data: { userId: reader, articleId: loserId, role: "user", content: "q" } });
  await prisma.tutorMessage.create({ data: { userId: reader, articleId: loserId, role: "assistant", content: "a" } });
  await prisma.quizAttempt.create({
    data: { userId: reader, articleId: loserId, correctCount: 3, totalQuestions: 4, scorePct: 75 },
  });
  await prisma.pronunciationAttempt.create({
    data: {
      userId: reader,
      articleId: loserId,
      referenceText: "hi",
      accuracyScore: 80,
      fluencyScore: 80,
      completenessScore: 80,
      pronScore: 80,
    },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.ok(outcome.migration, "migration summary present");
    assert.equal(outcome.migration?.readingProgress.repointed, 1);
    assert.equal(outcome.migration?.tutorMessages.repointed, 2);
    assert.equal(outcome.migration?.quizAttempts.repointed, 1);
    assert.equal(outcome.migration?.pronunciationAttempts.repointed, 1);
  }

  const rp = await prisma.readingProgress.findUnique({
    where: { userId_articleId: { userId: reader, articleId: survivorId } },
  });
  assert.equal(rp?.percent, 55, "reading progress moved to survivor");
  assert.equal(await prisma.readingProgress.count({ where: { articleId: loserId } }), 0, "none left on loser");
  assert.equal(await prisma.tutorMessage.count({ where: { articleId: survivorId } }), 2, "tutor messages moved");
  assert.equal(await prisma.quizAttempt.count({ where: { articleId: survivorId } }), 1, "quiz attempt moved");
  assert.equal(
    await prisma.pronunciationAttempt.count({ where: { articleId: survivorId } }),
    1,
    "pronunciation moved",
  );
});

// ---------------------------------------------------------------------------
// ReadingProgress collision — keep the MORE-ADVANCED record either way.
// ---------------------------------------------------------------------------

test("ReadingProgress collision keeps the survivor's more-advanced record", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.readingProgress.create({ data: { userId: reader, articleId: survivorId, percent: 90 } });
  await prisma.readingProgress.create({ data: { userId: reader, articleId: loserId, percent: 10 } });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.readingProgress.merged, 1);
    assert.equal(outcome.migration?.readingProgress.repointed, 0);
  }

  const rp = await prisma.readingProgress.findUnique({
    where: { userId_articleId: { userId: reader, articleId: survivorId } },
  });
  assert.equal(rp?.percent, 90, "survivor keeps its more-advanced progress");
  assert.equal(await prisma.readingProgress.count({ where: { articleId: loserId } }), 0, "loser dup removed");
  assert.equal(await prisma.readingProgress.count({ where: { userId: reader } }), 1, "exactly one record survives");
});

test("ReadingProgress collision adopts the loser's more-advanced record", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.readingProgress.create({ data: { userId: reader, articleId: survivorId, percent: 15 } });
  await prisma.readingProgress.create({
    data: { userId: reader, articleId: loserId, percent: 95, completed: true, completedAt: new Date() },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.readingProgress.merged, 1);
  }

  const rp = await prisma.readingProgress.findUnique({
    where: { userId_articleId: { userId: reader, articleId: survivorId } },
  });
  assert.equal(rp?.percent, 95, "survivor row adopts the loser's higher progress");
  assert.equal(rp?.completed, true, "completion flag adopted from the loser");
  assert.equal(await prisma.readingProgress.count({ where: { userId: reader } }), 1, "still exactly one record");
});

// ---------------------------------------------------------------------------
// ReadingListItem — dedupe when survivor already in list, else repoint.
// ---------------------------------------------------------------------------

test("ReadingListItem dedupes an already-present survivor and repoints otherwise", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  const sharedList = id("list");
  const soloList = id("list");
  await prisma.readingList.create({ data: { id: sharedList, userId: reader, name: "Shared" } });
  await prisma.readingList.create({ data: { id: soloList, userId: reader, name: "Solo" } });
  // Shared list already holds the survivor AND the loser (collision on resolve).
  await prisma.readingListItem.create({ data: { listId: sharedList, articleId: survivorId } });
  await prisma.readingListItem.create({ data: { listId: sharedList, articleId: loserId } });
  // Solo list holds only the loser (no collision → repoint).
  await prisma.readingListItem.create({ data: { listId: soloList, articleId: loserId } });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.readingListItems.merged, 1, "one duplicate deduped");
    assert.equal(outcome.migration?.readingListItems.repointed, 1, "one membership repointed");
  }

  assert.equal(
    await prisma.readingListItem.count({ where: { listId: sharedList, articleId: survivorId } }),
    1,
    "shared list keeps exactly one survivor membership",
  );
  assert.equal(await prisma.readingListItem.count({ where: { articleId: loserId } }), 0, "no loser memberships left");
  assert.equal(
    await prisma.readingListItem.count({ where: { listId: soloList, articleId: survivorId } }),
    1,
    "solo list membership repointed to survivor",
  );
});

// ---------------------------------------------------------------------------
// ArticleMastery + ArticleDifficultyFeedback — keep most-recent on collision.
// ---------------------------------------------------------------------------

test("ArticleMastery collision keeps the most-recent record", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-06-01T00:00:00Z");
  await prisma.articleMastery.create({
    data: { userId: reader, articleId: survivorId, comprehensionScore: 0.3, lastActivityAt: older },
  });
  await prisma.articleMastery.create({
    data: { userId: reader, articleId: loserId, comprehensionScore: 0.8, lastActivityAt: newer },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.articleMastery.merged, 1);
  }

  const mastery = await prisma.articleMastery.findUnique({
    where: { userId_articleId: { userId: reader, articleId: survivorId } },
  });
  assert.equal(mastery?.comprehensionScore, 0.8, "survivor adopts the more-recent mastery");
  assert.equal(await prisma.articleMastery.count({ where: { userId: reader } }), 1, "exactly one mastery record");
});

test("ArticleDifficultyFeedback collision keeps the most-recent vote", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.articleDifficultyFeedback.create({
    data: { userId: reader, articleId: survivorId, vote: "too_easy", updatedAt: new Date("2026-01-01T00:00:00Z") },
  });
  await prisma.articleDifficultyFeedback.create({
    data: { userId: reader, articleId: loserId, vote: "too_hard", updatedAt: new Date("2026-06-01T00:00:00Z") },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");

  const feedback = await prisma.articleDifficultyFeedback.findUnique({
    where: { userId_articleId: { userId: reader, articleId: survivorId } },
  });
  assert.equal(feedback?.vote, "too_hard", "survivor adopts the more-recent vote");
  assert.equal(await prisma.articleDifficultyFeedback.count({ where: { userId: reader } }), 1);
});

// ---------------------------------------------------------------------------
// Highlight — re-anchor success, skip-on-failure, dedupe.
// ---------------------------------------------------------------------------

test("Highlight re-anchors reliably onto the survivor's current content", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict(SURVIVOR_TEXT, "loser body");
  const reader = await createUser();
  // Stored offsets are wrong for the survivor text → forces an unambiguous MOVE.
  await prisma.highlight.create({
    data: { userId: reader, articleId: loserId, quote: "brown fox", startOffset: 3, endOffset: 12 },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.highlights.repointed, 1);
    assert.equal(outcome.migration?.highlights.skipped, 0);
  }

  const moved = await prisma.highlight.findUnique({
    where: {
      userId_articleId_startOffset_endOffset: {
        userId: reader,
        articleId: survivorId,
        startOffset: FOX_START,
        endOffset: FOX_END,
      },
    },
  });
  assert.ok(moved, "highlight re-anchored onto the survivor at the resolved offsets");
  assert.equal(await prisma.highlight.count({ where: { articleId: loserId } }), 0, "none left on loser");
});

test("Highlight that cannot be re-anchored is SKIPPED (left on the loser)", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict(SURVIVOR_TEXT, "loser body");
  const reader = await createUser();
  await prisma.highlight.create({
    data: { userId: reader, articleId: loserId, quote: "zebra unicorn", startOffset: 0, endOffset: 13 },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.highlights.repointed, 0);
    assert.equal(outcome.migration?.highlights.skipped, 1, "unresolvable anchor skipped, never dropped");
  }

  assert.equal(await prisma.highlight.count({ where: { articleId: loserId } }), 1, "highlight retained on loser");
  assert.equal(await prisma.highlight.count({ where: { articleId: survivorId } }), 0, "survivor unchanged");
});

test("Highlight re-anchoring dedupes against an existing survivor highlight", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict(SURVIVOR_TEXT, "loser body");
  const reader = await createUser();
  // Survivor already owns the exact re-anchored slot for this user.
  await prisma.highlight.create({
    data: { userId: reader, articleId: survivorId, quote: "brown fox", startOffset: FOX_START, endOffset: FOX_END },
  });
  await prisma.highlight.create({
    data: { userId: reader, articleId: loserId, quote: "brown fox", startOffset: 3, endOffset: 12 },
  });

  const outcome = await resolve(conflictId, survivorId, true);
  assert.ok(outcome.ok && outcome.kind === "applied");
  if (outcome.ok && outcome.kind === "applied") {
    assert.equal(outcome.migration?.highlights.merged, 1, "duplicate anchor deduped");
    assert.equal(outcome.migration?.highlights.repointed, 0);
  }

  assert.equal(
    await prisma.highlight.count({
      where: { userId: reader, articleId: survivorId, startOffset: FOX_START, endOffset: FOX_END },
    }),
    1,
    "survivor keeps exactly one highlight at the slot",
  );
  assert.equal(await prisma.highlight.count({ where: { articleId: loserId } }), 0, "loser duplicate removed");
});

// ---------------------------------------------------------------------------
// Atomicity — concurrent opt-in resolves preserve uniqueness.
// ---------------------------------------------------------------------------

test("two concurrent opt-in resolves migrate exactly once and preserve uniqueness", { skip: !enabled }, async () => {
  const { conflictId, survivorId, loserId } = await seedConflict();
  const reader = await createUser();
  await prisma.readingProgress.create({ data: { userId: reader, articleId: loserId, percent: 33 } });

  const [a, b] = await Promise.all([
    resolve(conflictId, survivorId, true),
    resolve(conflictId, survivorId, true),
  ]);

  const applied = [a, b].filter((r) => r.ok && r.kind === "applied");
  assert.equal(applied.length, 1, "exactly one resolver applies");
  for (const r of [a, b]) {
    assert.ok(
      (r.ok && (r.kind === "applied" || r.kind === "noop")) || (!r.ok && r.reason === "stale"),
      `safe outcome, got ${JSON.stringify(r)}`,
    );
  }

  assert.equal(
    await prisma.readingProgress.count({ where: { userId: reader } }),
    1,
    "uniqueness preserved: exactly one reading-progress record",
  );
  assert.equal(
    await prisma.readingProgress.count({ where: { userId: reader, articleId: survivorId } }),
    1,
    "the single record is on the survivor",
  );
});
