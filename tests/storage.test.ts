import { test, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

process.env.LOG_LEVEL = "error";

const TEST_DIR = path.resolve(process.cwd(), ".media-test");

type SpeechRow = {
  id: string;
  articleId: string;
  mimeType: string;
  voice: string | null;
  format: string | null;
  audioBase64: string | null;
  words: unknown;
  storageKey: string | null;
  mediaAssetId: string | null;
};

let speechRows: SpeechRow[];
let mediaAssets: Map<string, Record<string, unknown>>;
let assetSeq = 0;

before(() => {
  const articleSpeech = {
    findMany: async (a: { where: { audioBase64?: unknown; storageKey: null } }) =>
      speechRows.filter((r) => r.audioBase64 != null && r.storageKey == null).map((r) => ({ ...r })),
    update: async (a: { where: { id: string }; data: Partial<SpeechRow> }) => {
      const row = speechRows.find((r) => r.id === a.where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, a.data);
      return row;
    },
  };
  const mediaAsset = {
    upsert: async (a: { where: { storageKey: string }; create: Record<string, unknown> }) => {
      let asset = mediaAssets.get(a.where.storageKey);
      if (!asset) {
        asset = { id: `ma-${++assetSeq}`, ...a.create };
        mediaAssets.set(a.where.storageKey, asset);
      }
      return { id: asset.id as string };
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech,
        mediaAsset,
        $transaction: async (fn: (tx: unknown) => unknown) => fn({ articleSpeech, mediaAsset }),
      },
    },
  });
});

beforeEach(() => {
  speechRows = [];
  mediaAssets = new Map();
  assetSeq = 0;
  delete process.env.MEDIA_STORAGE;
  delete process.env.MEDIA_STORAGE_DIR;
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("getMediaStorage returns null in the default (database) mode", async () => {
  const { getMediaStorage, isObjectStorageConfigured, mediaStorageKind } = await import(
    "@/lib/storage"
  );
  assert.equal(mediaStorageKind(), "database");
  assert.equal(getMediaStorage(), null);
  assert.equal(isObjectStorageConfigured(), false);
});

test("getMediaStorage returns null for cloud seams without an SDK", async () => {
  process.env.MEDIA_STORAGE = "s3";
  const { getMediaStorage, isObjectStorageConfigured } = await import("@/lib/storage");
  assert.equal(getMediaStorage(), null);
  assert.equal(isObjectStorageConfigured(), false);
});

test("FilesystemMediaStorage put/get/delete round-trips content-addressed bytes", async () => {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);
  if (!storage) return;

  const data = Buffer.from("hello-audio-bytes");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech/a1" });
  assert.equal(put.checksum, sha256Hex(data));
  assert.equal(put.sizeBytes, data.length);
  assert.ok(put.storageKey.includes(put.checksum));

  const read = await storage.get(put.storageKey);
  assert.ok(read);
  assert.equal(read?.toString(), "hello-audio-bytes");

  // Content-addressed: same bytes => same key.
  const put2 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech/a1" });
  assert.equal(put2.storageKey, put.storageKey);

  await storage.delete(put.storageKey);
  assert.equal(await storage.get(put.storageKey), null);
});

test("get rejects path-traversal keys", async () => {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);
  if (!storage) return;
  assert.equal(await storage.get("../../etc/passwd"), null);
});

test("migrateArticleSpeechToStorage is a no-op when storage is unconfigured", async () => {
  const { migrateArticleSpeechToStorage } = await import("@/lib/storage");
  speechRows.push({
    id: "s1",
    articleId: "a1",
    mimeType: "audio/mpeg",
    voice: null,
    format: null,
    audioBase64: Buffer.from("x").toString("base64"),
    words: [],
    storageKey: null,
    mediaAssetId: null,
  });
  const result = await migrateArticleSpeechToStorage();
  assert.equal(result.skippedNoStorage, true);
  assert.equal(result.migrated, 0);
  // Base64 left intact.
  assert.ok(speechRows[0].audioBase64);
});

test("migrateArticleSpeechToStorage migrates base64 to storage and is idempotent", async () => {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { migrateArticleSpeechToStorage } = await import("@/lib/storage");
  speechRows.push({
    id: "s1",
    articleId: "a1",
    mimeType: "audio/mpeg",
    voice: "en-US",
    format: "mp3",
    audioBase64: Buffer.from("audio-1").toString("base64"),
    words: [{ word: "audio", offset: 0, duration: 1500 }],
    storageKey: null,
    mediaAssetId: null,
  });

  const first = await migrateArticleSpeechToStorage();
  assert.equal(first.skippedNoStorage, false);
  assert.equal(first.scanned, 1);
  assert.equal(first.migrated, 1);
  assert.equal(first.failed, 0);

  const row = speechRows[0];
  assert.equal(row.audioBase64, null, "base64 cleared after migration");
  assert.ok(row.storageKey, "storage key recorded");
  assert.ok(row.mediaAssetId, "media asset linked");
  assert.equal(mediaAssets.size, 1);

  // Re-run: nothing eligible (base64 null + storageKey set).
  const second = await migrateArticleSpeechToStorage();
  assert.equal(second.scanned, 0);
  assert.equal(second.migrated, 0);
});
