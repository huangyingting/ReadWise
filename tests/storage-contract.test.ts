/**
 * Storage adapter contract tests.
 *
 * Every MediaStorage implementation must pass the same behavioral contract:
 *   - key generation: storageKey is content-addressed; same bytes → same key.
 *   - checksum: sha256 of stored bytes is returned in PutMediaResult.
 *   - get missing object: returns null without throwing.
 *   - put/get round trip: bytes survive a put→get cycle unchanged.
 *   - delete idempotency: delete of a missing key does not throw.
 *
 * Azure SDK calls are fully mocked. No real network or filesystem side-effects
 * outside the test-scoped `.media-contract-test` directory.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

const TEST_DIR = path.resolve(process.cwd(), ".media-contract-test");

// ─── Azure mock state ────────────────────────────────────────────────────────
type MockBlob = { data: Buffer; contentType: string };
let azureBlobs: Map<string, MockBlob>;
let azureSdkFails = false;

before(() => {
  mock.module("@azure/storage-blob", {
    namedExports: {
      BlobServiceClient: class MockBlobServiceClient {
        static fromConnectionString(_c: string) {
          return new MockBlobServiceClient();
        }
        getContainerClient(_name: string) {
          return {
            createIfNotExists: async () => {},
            getBlockBlobClient: (key: string) => ({
              uploadData: async (
                data: Buffer,
                opts: { blobHTTPHeaders: { blobContentType: string } },
              ) => {
                if (azureSdkFails) throw new Error("sdk unavailable");
                azureBlobs.set(key, { data, contentType: opts.blobHTTPHeaders.blobContentType });
              },
              download: async () => {
                if (azureSdkFails) throw new Error("sdk unavailable");
                const blob = azureBlobs.get(key);
                if (!blob) {
                  const err = Object.assign(new Error("BlobNotFound"), { statusCode: 404 });
                  throw err;
                }
                return {
                  readableStreamBody: (async function* () {
                    yield blob.data;
                  })(),
                };
              },
              deleteIfExists: async () => {
                azureBlobs.delete(key);
              },
            }),
          };
        }
      },
      StorageSharedKeyCredential: class {
        constructor(_account: string, _key: string) {}
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: { findMany: async () => [] },
        mediaAsset: { upsert: async () => ({ id: "ma1" }) },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      },
    },
  });
});

beforeEach(() => {
  azureBlobs = new Map();
  azureSdkFails = false;
  delete process.env.MEDIA_STORAGE;
  delete process.env.MEDIA_STORAGE_DIR;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT;
  delete process.env.AZURE_STORAGE_KEY;
  delete process.env.AZURE_STORAGE_CONTAINER;
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function withFilesystem() {
  process.env.MEDIA_STORAGE = "filesystem";
  process.env.MEDIA_STORAGE_DIR = TEST_DIR;
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage, "filesystem storage must be non-null");
  return { storage: storage!, sha256Hex };
}

async function withAzure() {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING =
    "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage, "azure storage must be non-null when credentials are set");
  return { storage: storage!, sha256Hex };
}

// ─── Contract: FilesystemMediaStorage ────────────────────────────────────────

test("[filesystem] put returns content-addressed key (checksum in path)", async () => {
  const { storage, sha256Hex } = await withFilesystem();
  const data = Buffer.from("contract-test-bytes");
  const result = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(result.checksum, sha256Hex(data));
  assert.ok(result.storageKey.includes(result.checksum));
  assert.equal(result.sizeBytes, data.byteLength);
});

test("[filesystem] put is content-addressed: same bytes → same key", async () => {
  const { storage } = await withFilesystem();
  const data = Buffer.from("idempotent-payload");
  const r1 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  const r2 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(r1.storageKey, r2.storageKey);
});

test("[filesystem] put/get round trip preserves bytes", async () => {
  const { storage } = await withFilesystem();
  const data = Buffer.from("hello-from-contract-test");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  const fetched = await storage.get(put.storageKey);
  assert.ok(fetched);
  assert.equal(fetched!.toString(), "hello-from-contract-test");
});

test("[filesystem] get missing key returns null without throwing", async () => {
  const { storage } = await withFilesystem();
  const result = await storage.get("speech/nonexistent-key.mp3");
  assert.equal(result, null);
});

test("[filesystem] get path-traversal key returns null without throwing", async () => {
  const { storage } = await withFilesystem();
  const result = await storage.get("../../etc/passwd");
  assert.equal(result, null);
});

test("[filesystem] delete existing key removes file", async () => {
  const { storage } = await withFilesystem();
  const data = Buffer.from("delete-me");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  await storage.delete(put.storageKey);
  assert.equal(await storage.get(put.storageKey), null);
});

test("[filesystem] delete missing key is idempotent (no throw)", async () => {
  const { storage } = await withFilesystem();
  await assert.doesNotReject(() => storage.delete("speech/missing.mp3"));
});

test("[filesystem] kind is 'local'", async () => {
  const { storage } = await withFilesystem();
  assert.equal(storage.kind, "local");
});

// ─── Contract: AzureBlobMediaStorage ─────────────────────────────────────────

test("[azure] put returns content-addressed key (checksum in path)", async () => {
  const { storage, sha256Hex } = await withAzure();
  const data = Buffer.from("azure-contract-bytes");
  const result = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(result.checksum, sha256Hex(data));
  assert.ok(result.storageKey.includes(result.checksum));
  assert.equal(result.sizeBytes, data.byteLength);
});

test("[azure] put is content-addressed: same bytes → same key", async () => {
  const { storage } = await withAzure();
  const data = Buffer.from("idempotent-azure-payload");
  const r1 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  const r2 = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(r1.storageKey, r2.storageKey);
});

test("[azure] put/get round trip preserves bytes", async () => {
  const { storage } = await withAzure();
  const data = Buffer.from("round-trip-azure");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  const fetched = await storage.get(put.storageKey);
  assert.ok(fetched);
  assert.equal(fetched!.toString(), "round-trip-azure");
});

test("[azure] get missing key returns null without throwing", async () => {
  const { storage } = await withAzure();
  const result = await storage.get("speech/nonexistent.mp3");
  assert.equal(result, null);
});

test("[azure] delete existing key is idempotent (uses deleteIfExists)", async () => {
  const { storage } = await withAzure();
  const data = Buffer.from("azure-delete-me");
  const put = await storage.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  await storage.delete(put.storageKey);
  assert.equal(await storage.get(put.storageKey), null);
});

test("[azure] delete missing key does not throw", async () => {
  const { storage } = await withAzure();
  await assert.doesNotReject(() => storage.delete("speech/ghost.mp3"));
});

test("[azure] kind is 'azure'", async () => {
  const { storage } = await withAzure();
  assert.equal(storage.kind, "azure");
});

// ─── Registry / runtime behavior ─────────────────────────────────────────────

test("local mode is the default media storage backend", async () => {
  const { getMediaStorage, isObjectStorageConfigured, mediaStorageKind } =
    await import("@/lib/storage");
  assert.equal(mediaStorageKind(), "local");
  const storage = getMediaStorage();
  assert.ok(storage);
  assert.equal(storage!.kind, "local");
  assert.equal(isObjectStorageConfigured(), true);
});

test("azure without credentials degrades gracefully to null", async () => {
  process.env.MEDIA_STORAGE = "azure";
  const { getMediaStorage } = await import("@/lib/storage");
  assert.equal(getMediaStorage(), null);
});

