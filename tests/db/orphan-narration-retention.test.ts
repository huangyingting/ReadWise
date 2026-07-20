/**
 * Reaper integration tests for orphaned narration media blobs
 * (#1131 — force-rescrape #1103 follow-up).
 *
 * Engine-agnostic like `rescrape-regen-reconcile.test.ts`: runs on SQLite by
 * default under `npm run test:db` and PostgreSQL in CI, guarded by `enabled`
 * (RUN_DB_INTEGRATION=1). Exercises the REAL `reapOrphanedNarrationAssets` /
 * `countOrphanedNarrationAssets` against the live database and proves:
 *
 *   - an orphaned speech asset (kind speech, ArticleSpeech null, past grace) is
 *     reaped: the blob is deleted, then the row is deleted;
 *   - a still-linked speech asset (ArticleSpeech references it) is NEVER touched;
 *   - a non-speech asset (kind "image") with no speech is NEVER touched;
 *   - a recent orphan (within grace) is skipped, then reaped once past the window
 *     (injected `now`);
 *   - idempotency: running the reaper twice reaps once (second run finds nothing);
 *   - blob-delete failure keeps the row (retryable) while a sibling success is
 *     reaped;
 *   - with no object storage configured, nothing is deleted (row survives).
 *
 * A fake storage is injected so no real filesystem/blob I/O occurs and specific
 * keys can be made to fail. Every MediaAsset uses a PREFIX-keyed storageKey so
 * the local `afterEach` sweeps any survivors (the shared cascade cleanup only
 * removes MediaAssets via their Article, and reaps delete rows outright). Only
 * counts are asserted — storageKeys/ids are never logged by the reaper.
 */
import assert from "node:assert/strict";

import { afterEach, test } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  countOrphanedNarrationAssets,
  reapOrphanedNarrationAssets,
  type OrphanReaperStorage,
} from "@/lib/media/orphan-narration-retention";

import { enabled, PREFIX } from "./support/db-config";
import { registerIntegrationCleanup, id } from "./support/db-helpers";

registerIntegrationCleanup();

afterEach(async () => {
  if (!enabled) return;
  // Orphan assets may have a null Article, so the shared Article-cascade sweep
  // misses them. Every fixture uses a PREFIX-keyed storageKey — delete here.
  await prisma.mediaAsset.deleteMany({ where: { storageKey: { startsWith: PREFIX } } });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A createdAt safely beyond the reaper's default 60-minute grace window. */
function pastGrace(): Date {
  return new Date(Date.now() - 2 * 60 * 60 * 1000);
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

/** Creates a MediaAsset with a PREFIX-keyed storageKey (default kind "speech"). */
async function createMediaAsset(opts: {
  articleId: string;
  createdAt: Date;
  kind?: string;
}): Promise<{ id: string; storageKey: string }> {
  const assetId = id("asset");
  const storageKey = `${PREFIX}speechkey_${assetId}`;
  await prisma.mediaAsset.create({
    data: {
      id: assetId,
      storageKey,
      kind: opts.kind ?? "speech",
      mimeType: "audio/mpeg",
      articleId: opts.articleId,
      createdAt: opts.createdAt,
    },
  });
  return { id: assetId, storageKey };
}

/** Links an ArticleSpeech to a MediaAsset so it is no longer an orphan. */
async function linkSpeech(articleId: string, mediaAssetId: string): Promise<void> {
  await prisma.articleSpeech.create({
    data: { articleId, mediaAssetId, words: [] },
  });
}

/** A fake MediaStorage that records deleted keys and can reject specific ones. */
function fakeStorage(opts: { rejectKeys?: Set<string> } = {}): {
  storage: OrphanReaperStorage;
  deleted: string[];
} {
  const deleted: string[] = [];
  const reject = opts.rejectKeys ?? new Set<string>();
  return {
    deleted,
    storage: {
      async delete(storageKey: string): Promise<void> {
        if (reject.has(storageKey)) throw new Error("blob delete failed");
        deleted.push(storageKey);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("reaps an orphaned speech asset: blob deleted then row deleted", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt: pastGrace() });
  const { storage, deleted } = fakeStorage();

  assert.equal(await countOrphanedNarrationAssets(), 1);

  const result = await reapOrphanedNarrationAssets({ storage });
  assert.equal(result.matched, 1);
  assert.equal(result.reaped, 1);
  assert.equal(result.failed, 0);

  // Blob deleted, then the row removed — backlog cleared.
  assert.deepEqual(deleted, [asset.storageKey]);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 0);
  assert.equal(await countOrphanedNarrationAssets(), 0);
});

test("never touches a still-linked speech asset", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt: pastGrace() });
  await linkSpeech(articleId, asset.id);
  const { storage, deleted } = fakeStorage();

  assert.equal(await countOrphanedNarrationAssets(), 0);
  const result = await reapOrphanedNarrationAssets({ storage });
  assert.equal(result.matched, 0);
  assert.deepEqual(deleted, []);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 1);
});

test("never touches a non-speech asset with a null speech relation", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt: pastGrace(), kind: "image" });
  const { storage, deleted } = fakeStorage();

  assert.equal(await countOrphanedNarrationAssets(), 0);
  const result = await reapOrphanedNarrationAssets({ storage });
  assert.equal(result.matched, 0);
  assert.deepEqual(deleted, []);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 1);
});

test("grace window: skips a recent orphan, reaps it once past the window", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const createdAt = new Date("2026-07-20T11:00:00.000Z");
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt });
  const { storage, deleted } = fakeStorage();

  // 30 minutes after creation: still inside the 60-minute grace → skipped.
  const inGrace = await reapOrphanedNarrationAssets({
    storage,
    now: new Date(createdAt.getTime() + 30 * 60 * 1000),
  });
  assert.equal(inGrace.matched, 0);
  assert.deepEqual(deleted, []);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 1);

  // 2 hours after creation: past the grace window → reaped exactly once.
  const pastWindow = await reapOrphanedNarrationAssets({
    storage,
    now: new Date(createdAt.getTime() + 2 * 60 * 60 * 1000),
  });
  assert.equal(pastWindow.matched, 1);
  assert.equal(pastWindow.reaped, 1);
  assert.deepEqual(deleted, [asset.storageKey]);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 0);
});

test("idempotency: running the reaper twice reaps exactly once", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt: pastGrace() });
  const { storage, deleted } = fakeStorage();

  const first = await reapOrphanedNarrationAssets({ storage });
  assert.equal(first.reaped, 1);

  const second = await reapOrphanedNarrationAssets({ storage });
  assert.equal(second.matched, 0);
  assert.equal(second.reaped, 0);

  assert.deepEqual(deleted, [asset.storageKey]);
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 0);
});

test("blob-delete failure keeps the row while a sibling success is reaped", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const failArticle = await createArticle();
  const failAsset = await createMediaAsset({ articleId: failArticle, createdAt: pastGrace() });
  const okArticle = await createArticle();
  const okAsset = await createMediaAsset({ articleId: okArticle, createdAt: pastGrace() });
  const { storage, deleted } = fakeStorage({ rejectKeys: new Set([failAsset.storageKey]) });

  const result = await reapOrphanedNarrationAssets({ storage });
  assert.equal(result.matched, 2);
  assert.equal(result.reaped, 1);
  assert.equal(result.failed, 1);

  // The failed blob keeps its row for a later retry; the sibling is gone.
  assert.deepEqual(deleted, [okAsset.storageKey]);
  assert.equal(await prisma.mediaAsset.count({ where: { id: failAsset.id } }), 1);
  assert.equal(await prisma.mediaAsset.count({ where: { id: okAsset.id } }), 0);
  // The surviving orphan is still counted for the next sweep.
  assert.equal(await countOrphanedNarrationAssets(), 1);
});

test("no object storage configured: nothing is deleted (rows survive)", async (t) => {
  if (!enabled) {
    t.skip("integration disabled");
    return;
  }
  const articleId = await createArticle();
  const asset = await createMediaAsset({ articleId, createdAt: pastGrace() });

  const result = await reapOrphanedNarrationAssets({ storage: null });
  assert.equal(result.matched, 1);
  assert.equal(result.reaped, 0);
  assert.equal(result.failed, 0);

  // Deleting the row without deleting the blob would leak it forever — skip.
  assert.equal(await prisma.mediaAsset.count({ where: { id: asset.id } }), 1);
});
