import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

process.env.LOG_LEVEL = "error";

const TEST_DIR = path.resolve(process.cwd(), ".media-test");

beforeEach(() => {
  delete process.env.MEDIA_STORAGE;
  delete process.env.MEDIA_STORAGE_DIR;
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

test("getMediaStorage returns local storage by default", async () => {
  const { getMediaStorage, isObjectStorageConfigured, mediaStorageKind } = await import(
    "@/lib/storage"
  );
  assert.equal(mediaStorageKind(), "local");
  const storage = getMediaStorage();
  assert.ok(storage);
  assert.equal(storage!.kind, "local");
  assert.equal(isObjectStorageConfigured(), true);
});

test("FilesystemMediaStorage put/get/delete round-trips content-addressed bytes", async () => {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);
  if (!storage) return;

  const data = Buffer.from("hello-audio-bytes");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(put.checksum, sha256Hex(data));
  assert.equal(put.sizeBytes, data.length);
  assert.ok(put.storageKey.includes(put.checksum));

  const read = await storage.get(put.storageKey);
  assert.ok(read);
  assert.equal(read?.toString(), "hello-audio-bytes");

  // Content-addressed: same bytes => same key.
  const put2 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(put2.storageKey, put.storageKey);

  await storage.delete(put.storageKey);
  assert.equal(await storage.get(put.storageKey), null);
});

test("FilesystemMediaStorage keeps a scoped digest flat under the key prefix", async () => {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);
  if (!storage) return;

  const data = Buffer.from("flat-speech-bytes");
  const put = await storage.put({
    data,
    mimeType: "audio/mpeg",
    keyHint: "speech",
    keyScope: "article-a1",
  });

  assert.match(put.storageKey, /^speech\/[a-f0-9]{32}\.mp3$/);
  assert.equal(put.storageKey.includes("article-a1"), false);
  assert.equal(put.storageKey.split("/").length, 2);
  assert.equal((await storage.get(put.storageKey))?.equals(data), true);

  const repeated = await storage.put({
    data,
    mimeType: "audio/mpeg",
    keyHint: "speech",
    keyScope: "article-a1",
  });
  const otherArticle = await storage.put({
    data,
    mimeType: "audio/mpeg",
    keyHint: "speech",
    keyScope: "article-a2",
  });
  assert.equal(repeated.storageKey, put.storageKey);
  assert.notEqual(otherArticle.storageKey, put.storageKey);
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
