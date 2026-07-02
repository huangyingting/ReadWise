process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
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
          if (mode === "container-fails") throw new Error("container unavailable");
        },
        getBlockBlobClient: (key: string) => ({
          deleteIfExists: async () => {
            if (mode === "delete-error") throw new Error("delete failed");
            deletedKeys.push(key);
          },
          download: async () => {
            if (mode === "download-no-stream") return {};
            if (mode === "download-error") throw new Error("download failed");
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
});

test("AzureBlobMediaStorage supports account-key auth and custom extensions", async () => {
  const { AzureBlobMediaStorage } = await import("@/lib/storage/azure");
  const storage = new AzureBlobMediaStorage({
    accountName: "account",
    accountKey: "test-key",
    container: "media",
  });

  const result = await storage.put({
    data: Buffer.from("audio"),
    mimeType: "audio/wav",
    extension: "custom",
    keyHint: "/Speech//Daily!",
  });

  assert.equal(storage.kind, "azure");
  assert.equal(constructedUrl, "https://account.blob.core.windows.net");
  assert.deepEqual(credentialArgs, ["account", "test-key"]);
  assert.equal(uploaded[0].key, result.storageKey);
  assert.match(result.storageKey, /^speech\/daily-/);
  assert.match(result.storageKey, /\.custom$/);
  assert.equal(uploaded[0].contentType, "audio/wav");
});

test("AzureBlobMediaStorage downloads chunks and degrades on read/delete/container failures", async () => {
  const { AzureBlobMediaStorage } = await import("@/lib/storage/azure");
  const storage = new AzureBlobMediaStorage({
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
});
