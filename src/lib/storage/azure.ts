import { createLogger } from "@/lib/observability/logger";
import type { MediaStorage, PutMediaInput, PutMediaResult } from "@/lib/storage/types";
import { extensionForMime, normalizeExtension, sanitizeKeyHint, sha256Hex } from "@/lib/storage/key";
import type { AzureStorageConfig, AzureStorageConnectionStringConfig } from "@/lib/runtime-config/storage";
export type { AzureStorageConfig, AzureStorageConnectionStringConfig } from "@/lib/runtime-config/storage";
export { azureStorageConfig } from "@/lib/runtime-config/storage";

const log = createLogger("storage");

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusCodeFromError(err: unknown): number | undefined {
  return err instanceof Object && "statusCode" in err
    ? (err as { statusCode?: number }).statusCode
    : undefined;
}

async function streamToBuffer(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

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

  private createServiceClient(
    azure: typeof import("@azure/storage-blob"),
  ): import("@azure/storage-blob").BlobServiceClient {
    const cfg = this.config;
    if ("connectionString" in cfg) {
      return azure.BlobServiceClient.fromConnectionString(
        cfg.connectionString,
      );
    }

    const credential = new azure.StorageSharedKeyCredential(
      cfg.accountName,
      cfg.accountKey,
    );
    return new azure.BlobServiceClient(
      `https://${cfg.accountName}.blob.core.windows.net`,
      credential,
    );
  }

  /** Returns a `ContainerClient` or null if the SDK or config is unavailable. */
  private async getContainer(): Promise<import("@azure/storage-blob").ContainerClient | null> {
    try {
      const azure = await import("@azure/storage-blob");
      const cfg = this.config;
      const serviceClient = this.createServiceClient(azure);
      const container = serviceClient.getContainerClient(cfg.container);
      await container.createIfNotExists();
      return container;
    } catch (err) {
      log.warn("storage.azure_container_unavailable", {
        error: errorMessage(err),
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
    const sizeBytes = input.data.byteLength;

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
      sizeBytes,
    });
    return {
      storageKey,
      sizeBytes,
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
      return streamToBuffer(
        response.readableStreamBody as AsyncIterable<
          Buffer | Uint8Array | string
        >,
      );
    } catch (err: unknown) {
      if (statusCodeFromError(err) === 404) return null;
      log.warn("storage.azure_get_failed", {
        storageKey,
        error: errorMessage(err),
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
        error: errorMessage(err),
      });
    }
  }
}