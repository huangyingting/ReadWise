process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let loggerEntries: Array<{ event: string; meta?: Record<string, unknown> }> = [];
const logger = {
  debug: () => {},
  error: (event: string, meta?: Record<string, unknown>) => loggerEntries.push({ event, meta }),
  info: () => {},
  warn: (event: string, meta?: Record<string, unknown>) => loggerEntries.push({ event, meta }),
};

type AzureMode = "ok" | "container-fails" | "download-no-stream" | "download-error" | "delete-error";

let mode: AzureMode;
let constructedUrl: string | null;
let credentialArgs: string[] | null;
let uploaded: Array<{ key: string; data: Buffer; contentType: string }>;
let deletedKeys: string[];

before(() => {
  class StorageSharedKeyCredential {
    constructor(account: string, key: string) {
      credentialArgs = [account, key];
    }
  }

  class BlobServiceClient {
    static fromConnectionString(connectionString: string) {
      constructedUrl = connectionString;
      return new BlobServiceClient("from-connection-string", null);
    }

    constructor(url: string, _credential: unknown) {
      constructedUrl = url;
    }

    getContainerClient(_container: string) {
      return {
        createIfNotExists: async () => {
          if (mode === "container-fails") throw new Error("container unavailable with private article sentence");
        },
        getBlockBlobClient: (key: string) => ({
          deleteIfExists: async () => {
            if (mode === "delete-error") throw new Error("delete failed with private article sentence");
            deletedKeys.push(key);
          },
          download: async () => {
            if (mode === "download-no-stream") return {};
            if (mode === "download-error") throw new Error("download failed with private article sentence");
            return {
              readableStreamBody: (async function* () {
                yield Buffer.from("first");
                yield "second";
              })(),
            };
          },
          uploadData: async (data: Buffer, opts: { blobHTTPHeaders: { blobContentType: string } }) => {
            uploaded.push({ key, data, contentType: opts.blobHTTPHeaders.blobContentType });
          },
        }),
      };
    }
  }

  mock.module("@azure/storage-blob", {
    namedExports: { BlobServiceClient, StorageSharedKeyCredential },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => logger,
    },
  });
});

beforeEach(() => {
  mode = "ok";
  constructedUrl = null;
  credentialArgs = null;
  uploaded = [];
  deletedKeys = [];
  loggerEntries = [];
});

async function createAzureStorage(
  options: ConstructorParameters<
    (typeof import("@/lib/storage/azure"))["AzureBlobMediaStorage"]
  >[0],
) {
  const { AzureBlobMediaStorage } = await import("@/lib/storage/azure");
  return new AzureBlobMediaStorage(options);
}

test("AzureBlobMediaStorage supports account-key auth and custom extensions", async () => {
  const storage = await createAzureStorage({
    accountName: "account",
    accountKey: "test-key",
    container: "media",
  });

  const result = await storage.put({
    data: Buffer.from("audio"),
    mimeType: "audio/wav",
    extension: "custom",
    keyHint: "/Speech//Daily!",
    keyScope: "Article/../A1",
  });

  assert.equal(storage.kind, "azure");
  assert.equal(constructedUrl, "https://account.blob.core.windows.net");
  assert.deepEqual(credentialArgs, ["account", "test-key"]);
  assert.equal(uploaded[0].key, result.storageKey);
  assert.match(result.storageKey, /^speech\/daily-\/[a-f0-9]{32}\.custom$/);
  assert.match(result.storageKey, /\.custom$/);
  assert.equal(uploaded[0].contentType, "audio/wav");
});

test("AzureBlobMediaStorage downloads chunks and degrades on read/delete/container failures", async () => {
  const storage = await createAzureStorage({
    connectionString: "UseDevelopmentStorage=true",
    container: "media",
  });

  assert.equal((await storage.get("speech/key.mp3"))?.toString(), "firstsecond");
  assert.equal(constructedUrl, "from-connection-string");

  mode = "download-no-stream";
  assert.equal(await storage.get("speech/key.mp3"), null);

  mode = "download-error";
  assert.equal(await storage.get("speech/key.mp3"), null);

  mode = "delete-error";
  await assert.doesNotReject(() => storage.delete("speech/key.mp3"));

  mode = "container-fails";
  assert.equal(await storage.get("speech/key.mp3"), null);
  await assert.doesNotReject(() => storage.delete("speech/key.mp3"));
  await assert.rejects(
    () =>
      storage.put({
        data: Buffer.from("audio"),
        mimeType: "audio/mpeg",
        keyHint: "speech",
      }),
    /container unavailable/i,
  );
  assert.doesNotMatch(JSON.stringify(loggerEntries), /private article sentence/);
  assert.ok(
    loggerEntries.some((entry) => entry.meta?.machineReason === "storage_read_failed"),
  );
  assert.ok(
    loggerEntries.some((entry) => entry.meta?.machineReason === "storage_delete_failed"),
  );
  assert.ok(
    loggerEntries.some((entry) => entry.meta?.machineReason === "container_unavailable"),
  );
});
