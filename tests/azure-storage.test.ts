/**
 * Tests for the Azure Blob Storage backend (#371).
 * All Azure SDK calls are mocked — no real cloud calls happen.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable state for the mock Azure SDK
let uploadDataCalled = false;
let uploadDataKey = "";
let uploadDataContentType = "";
let uploadDataBytes: Buffer | null = null;
let downloadShouldFail = false;
let downloadBytes: Buffer | null = null;
let deleteIfExistsCalled = false;
let deleteIfExistsKey = "";
let createIfNotExistsCalled = false;
let sdkLoadShouldFail = false;

before(() => {
  // Mock prisma (not used by azure tests but storage.ts imports it at module level)
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        articleSpeech: { findMany: async () => [] },
        mediaAsset: { upsert: async () => ({ id: "ma1" }) },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      },
    },
  });

  // Mock @azure/storage-blob
  mock.module("@azure/storage-blob", {
    namedExports: {
      BlobServiceClient: class MockBlobServiceClient {
        static fromConnectionString(_connStr: string) {
          return new MockBlobServiceClient();
        }
        constructor() {}
        getContainerClient(_container: string) {
          return {
            createIfNotExists: async () => {
              createIfNotExistsCalled = true;
            },
            getBlockBlobClient: (key: string) => ({
              uploadData: async (data: Buffer, opts: { blobHTTPHeaders: { blobContentType: string } }) => {
                uploadDataCalled = true;
                uploadDataKey = key;
                uploadDataContentType = opts.blobHTTPHeaders.blobContentType;
                uploadDataBytes = data;
              },
              download: async () => {
                if (downloadShouldFail) {
                  const err = new Error("BlobNotFound");
                  (err as unknown as Record<string, unknown>).statusCode = 404;
                  throw err;
                }
                return {
                  readableStreamBody: (async function* () {
                    if (downloadBytes) yield downloadBytes;
                  })(),
                };
              },
              deleteIfExists: async () => {
                deleteIfExistsCalled = true;
                deleteIfExistsKey = key;
              },
            }),
          };
        }
      },
      StorageSharedKeyCredential: class MockCred {
        constructor(_accountName: string, _accountKey: string) {}
      },
    },
  });
});

beforeEach(() => {
  uploadDataCalled = false;
  uploadDataKey = "";
  uploadDataContentType = "";
  uploadDataBytes = null;
  downloadShouldFail = false;
  downloadBytes = null;
  deleteIfExistsCalled = false;
  deleteIfExistsKey = "";
  createIfNotExistsCalled = false;
  sdkLoadShouldFail = false;
  delete process.env.MEDIA_STORAGE;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT;
  delete process.env.AZURE_STORAGE_KEY;
  delete process.env.AZURE_STORAGE_CONTAINER;
});

test("azureStorageConfig returns null when no credentials set", async () => {
  const { azureStorageConfig } = await import("@/lib/storage");
  assert.equal(azureStorageConfig(), null);
});

test("azureStorageConfig returns connection-string config", async () => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;...";
  const { azureStorageConfig } = await import("@/lib/storage");
  const cfg = azureStorageConfig();
  assert.ok(cfg);
  assert.ok("connectionString" in cfg!);
  assert.equal((cfg as { connectionString: string }).connectionString, "DefaultEndpointsProtocol=https;...");
  assert.equal(cfg!.container, "media");
});

test("azureStorageConfig uses AZURE_STORAGE_CONTAINER when set", async () => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = "conn";
  process.env.AZURE_STORAGE_CONTAINER = "my-bucket";
  const { azureStorageConfig } = await import("@/lib/storage");
  const cfg = azureStorageConfig();
  assert.equal(cfg!.container, "my-bucket");
});

test("azureStorageConfig returns account+key config", async () => {
  process.env.AZURE_STORAGE_ACCOUNT = "myaccount";
  process.env.AZURE_STORAGE_KEY = "mykey==";
  const { azureStorageConfig } = await import("@/lib/storage");
  const cfg = azureStorageConfig();
  assert.ok(cfg);
  assert.ok("accountName" in cfg!);
  assert.equal((cfg as { accountName: string }).accountName, "myaccount");
});

test("getMediaStorage returns null for azure with no credentials", async () => {
  process.env.MEDIA_STORAGE = "azure";
  const { getMediaStorage } = await import("@/lib/storage");
  assert.equal(getMediaStorage(), null);
});

test("getMediaStorage returns AzureBlobMediaStorage when azure creds present", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage, "should return a storage backend");
  assert.equal(storage!.kind, "azure");
});

test("AzureBlobMediaStorage put uploads with correct container/key/content-type", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage, sha256Hex } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);

  const data = Buffer.from("test-audio-bytes");
  const result = await storage!.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });

  assert.ok(uploadDataCalled, "uploadData should have been called");
  assert.equal(uploadDataContentType, "audio/mpeg");
  assert.ok(result.storageKey.startsWith("speech/"));
  assert.equal(result.storageKey.split("/").length, 2);
  assert.ok(result.storageKey.includes(sha256Hex(data)));
  assert.equal(result.sizeBytes, data.byteLength);
  assert.equal(result.checksum, sha256Hex(data));
  assert.ok(createIfNotExistsCalled);
});

test("AzureBlobMediaStorage get returns bytes from storage", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);

  downloadBytes = Buffer.from("hello-audio");
  const bytes = await storage!.get("speech/abc123.mp3");
  assert.ok(bytes);
  assert.equal(bytes!.toString(), "hello-audio");
});

test("AzureBlobMediaStorage get returns null on 404 (blob not found)", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);

  downloadShouldFail = true;
  const bytes = await storage!.get("speech/missing.mp3");
  assert.equal(bytes, null);
});

test("AzureBlobMediaStorage delete is idempotent (uses deleteIfExists)", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);

  await storage!.delete("speech/abc123.mp3");
  assert.ok(deleteIfExistsCalled);
  assert.equal(deleteIfExistsKey, "speech/abc123.mp3");
});

test("AzureBlobMediaStorage put returns content-addressed key (same bytes → same key)", async () => {
  process.env.MEDIA_STORAGE = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  const { getMediaStorage } = await import("@/lib/storage");
  const storage = getMediaStorage();
  assert.ok(storage);

  const data = Buffer.from("idempotent-bytes");
  const r1 = await storage!.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  const r2 = await storage!.put({ data, mimeType: "audio/mpeg", keyHint: "speech" });
  assert.equal(r1.storageKey, r2.storageKey);
});
