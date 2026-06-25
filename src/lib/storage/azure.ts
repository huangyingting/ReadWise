import { createLogger } from "@/lib/logger";
import type { AzureStorageConfig, AzureStorageConnectionStringConfig } from "@/lib/storage/config";
import type { MediaStorage, PutMediaInput, PutMediaResult } from "@/lib/storage/types";
import { extensionForMime, normalizeExtension, sanitizeKeyHint, sha256Hex } from "@/lib/storage/key";

const log = createLogger("storage");

/** Azure Blob Storage–backed {@link MediaStorage}. */
export class AzureBlobMediaStorage implements MediaStorage {
  readonly kind = "azure" as const;
  private readonly config:
    | AzureStorageConfig
    | AzureStorageConnectionStringConfig;

  constructor(
    config: AzureStorageConfig | AzureStorageConnectionStringConfig,
  ) {
    this.config = config;
  }

  /** Returns a `ContainerClient` or null if the SDK or config is unavailable. */
  private async getContainer(): Promise<import("@azure/storage-blob").ContainerClient | null> {
    try {
      const { BlobServiceClient, StorageSharedKeyCredential } =
        await import("@azure/storage-blob");
      const cfg = this.config;
      let serviceClient: import("@azure/storage-blob").BlobServiceClient;
      if ("connectionString" in cfg) {
        serviceClient = BlobServiceClient.fromConnectionString(
          cfg.connectionString,
        );
      } else {
        const credential = new StorageSharedKeyCredential(
          cfg.accountName,
          cfg.accountKey,
        );
        serviceClient = new BlobServiceClient(
          `https://${cfg.accountName}.blob.core.windows.net`,
          credential,
        );
      }
      const container = serviceClient.getContainerClient(cfg.container);
      await container.createIfNotExists();
      return container;
    } catch (err) {
      log.warn("storage.azure_container_unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async put(input: PutMediaInput): Promise<PutMediaResult> {
    const checksum = sha256Hex(input.data);
    const ext =
      normalizeExtension(input.extension) ?? extensionForMime(input.mimeType);
    const prefix = sanitizeKeyHint(input.keyHint);
    const storageKey = `${prefix}/${checksum}${ext}`;

    const container = await this.getContainer();
    if (!container) {
      throw new Error("Azure Blob Storage container unavailable");
    }

    const blobClient = container.getBlockBlobClient(storageKey);
    await blobClient.uploadData(input.data, {
      blobHTTPHeaders: { blobContentType: input.mimeType },
    });
    log.info("storage.azure_put", {
      storageKey,
      sizeBytes: input.data.byteLength,
    });
    return {
      storageKey,
      sizeBytes: input.data.byteLength,
      checksum,
    };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    const container = await this.getContainer();
    if (!container) return null;
    try {
      const blobClient = container.getBlockBlobClient(storageKey);
      const response = await blobClient.download();
      if (!response.readableStreamBody) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: unknown) {
      const status =
        err instanceof Object && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      if (status === 404) return null;
      log.warn("storage.azure_get_failed", {
        storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const container = await this.getContainer();
    if (!container) return;
    try {
      const blobClient = container.getBlockBlobClient(storageKey);
      await blobClient.deleteIfExists();
    } catch (err) {
      log.warn("storage.azure_delete_failed", {
        storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}