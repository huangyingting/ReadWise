/**
 * Media object-storage abstraction (Epic RW-E009 — RW-049).
 *
 * Large audio/media payloads (narration mp3, etc.) should not live forever as
 * base64 blobs inside the relational DB. This module is the single storage
 * SEAM, with a strict graceful-degradation contract so the app runs with ZERO
 * cloud configuration:
 *
 *   - `MEDIA_STORAGE` unset / "database": {@link getMediaStorage} returns null,
 *     callers keep storing audio in `ArticleSpeech.audioBase64` (historical
 *     behavior — nothing breaks without any setup).
 *   - `MEDIA_STORAGE=filesystem` (or "local"): a filesystem-backed store writes
 *     payloads under `MEDIA_STORAGE_DIR` (default `./.media`) keyed by a
 *     content-addressed storage key; metadata is recorded in `MediaAsset`.
 *   - `s3` / `azure` / `r2`: documented SEAMS. Selecting one without a bundled
 *     cloud SDK logs a warning and falls back to null (DB base64). No hard cloud
 *     dependency is pulled into the bundle.
 *
 * Reader playback works in BOTH modes: audio is served either from a storage
 * key (read back + re-encoded to a data URL) or from the legacy base64 column.
 * A one-shot, idempotent {@link migrateArticleSpeechToStorage} helper moves
 * existing base64 audio into storage WITHOUT deleting base64 until the storage
 * write + MediaAsset record succeed.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("storage");

/** Storage backends selectable via `MEDIA_STORAGE`. */
export type MediaStorageKind = "database" | "filesystem" | "s3" | "azure" | "r2";

/** Cloud seams that require runtime SDK loading (not bundled). */
const CLOUD_SEAMS: readonly MediaStorageKind[] = ["s3", "azure", "r2"];

export type PutMediaInput = {
  /** Raw bytes to persist. */
  data: Buffer;
  mimeType: string;
  /** Logical key prefix hint (e.g. `speech`); a content hash is appended. */
  keyHint?: string;
  /** Optional explicit extension (e.g. `.mp3`); inferred from `mimeType` otherwise. */
  extension?: string;
};

export type PutMediaResult = {
  /** Stable, content-addressed key used to read/delete the payload later. */
  storageKey: string;
  sizeBytes: number;
  /** Lowercase hex sha-256 of the stored bytes. */
  checksum: string;
};

/** The minimal object-storage contract. Implementations must be side-effect-safe. */
export interface MediaStorage {
  readonly kind: MediaStorageKind;
  put(input: PutMediaInput): Promise<PutMediaResult>;
  get(storageKey: string): Promise<Buffer | null>;
  delete(storageKey: string): Promise<void>;
}

/** Lowercase hex sha-256 of a buffer. */
export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Reads the configured backend kind from the environment (defaults to database). */
export function mediaStorageKind(): MediaStorageKind {
  const raw = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "database" || raw === "db" || raw === "none") return "database";
  if (raw === "filesystem" || raw === "local" || raw === "fs") return "filesystem";
  if (raw === "s3" || raw === "azure" || raw === "r2") return raw as MediaStorageKind;
  log.warn("storage.unknown_kind", { value: raw, fallback: "database" });
  return "database";
}

/** Base directory for the filesystem backend (default `./.media`). */
export function mediaStorageDir(): string {
  const dir = (process.env.MEDIA_STORAGE_DIR ?? "").trim();
  return dir ? path.resolve(dir) : path.resolve(process.cwd(), ".media");
}

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/ogg":
    case "audio/opus":
      return ".ogg";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/webm":
      return ".webm";
    default:
      return ".bin";
  }
}

function normalizeExtension(ext: string | undefined): string | null {
  if (!ext) return null;
  const trimmed = ext.trim().toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

/** Strips path-traversal and unsafe characters from a key-prefix hint. */
function sanitizeKeyHint(hint: string | undefined): string {
  if (!hint) return "media";
  const cleaned = hint
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\.{2,}/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
  return cleaned || "media";
}

// ---------------------------------------------------------------------------
// Azure Blob Storage backend (#371)
// ---------------------------------------------------------------------------

export type AzureStorageConfig = {
  /** Azure Storage account name (for account-key auth). */
  accountName: string;
  /** Azure Storage account key (for account-key auth). */
  accountKey: string;
  /** Blob container to store media assets in. */
  container: string;
};

export type AzureStorageConnectionStringConfig = {
  /** Full connection string (alternative to account-name+key). */
  connectionString: string;
  /** Blob container to store media assets in. */
  container: string;
};

/**
 * Reads Azure Blob Storage configuration from environment variables.
 * Supports both connection-string and account-name+account-key auth.
 * Returns null when credentials are absent so the caller can skip Azure.
 */
export function azureStorageConfig():
  | AzureStorageConfig
  | AzureStorageConnectionStringConfig
  | null {
  const container =
    (process.env.AZURE_STORAGE_CONTAINER ?? "").trim() || "media";
  const connStr = (process.env.AZURE_STORAGE_CONNECTION_STRING ?? "").trim();
  if (connStr) {
    return { connectionString: connStr, container };
  }
  const accountName = (process.env.AZURE_STORAGE_ACCOUNT ?? "").trim();
  const accountKey = (process.env.AZURE_STORAGE_KEY ?? "").trim();
  if (accountName && accountKey) {
    return { accountName, accountKey, container };
  }
  return null;
}

/**
 * Azure Blob Storage–backed {@link MediaStorage}.
 *
 * Uses a lazy `import("@azure/storage-blob")` to avoid bundling the SDK in
 * the browser bundle or crashing at startup when the package is absent.
 * All methods degrade safely: construction never throws for missing creds.
 */
class AzureBlobMediaStorage implements MediaStorage {
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
      // Ensure the container exists; createIfNotExists is idempotent.
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
      // 404 → blob doesn't exist; return null (graceful missing).
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

/** Filesystem-backed {@link MediaStorage}. Content-addressed, traversal-safe. */
class FilesystemMediaStorage implements MediaStorage {
  readonly kind = "filesystem" as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** Confines a storage key to `baseDir`, rejecting traversal escapes. */
  private resolve(storageKey: string): string {
    const full = path.resolve(this.baseDir, storageKey);
    const base = path.resolve(this.baseDir);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error("storage key escapes media base directory");
    }
    return full;
  }

  async put(input: PutMediaInput): Promise<PutMediaResult> {
    const checksum = sha256Hex(input.data);
    const ext = normalizeExtension(input.extension) ?? extensionForMime(input.mimeType);
    const prefix = sanitizeKeyHint(input.keyHint);
    const storageKey = `${prefix}/${checksum}${ext}`;
    const full = this.resolve(storageKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.data);
    return { storageKey, sizeBytes: input.data.byteLength, checksum };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(storageKey));
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(storageKey));
    } catch {
      // Idempotent: a missing file is already "deleted".
    }
  }
}

/**
 * Resolves the active {@link MediaStorage}, or `null` when object storage is
 * unconfigured (DB base64 mode). Intentionally NOT cached so a test (or a
 * runtime env change) is reflected immediately; construction is cheap.
 */
export function getMediaStorage(): MediaStorage | null {
  const kind = mediaStorageKind();
  switch (kind) {
    case "database":
      return null;
    case "filesystem":
      return new FilesystemMediaStorage(mediaStorageDir());
    case "azure": {
      const cfg = azureStorageConfig();
      if (cfg) {
        return new AzureBlobMediaStorage(cfg);
      }
      log.warn("storage.cloud_seam_unconfigured", {
        kind,
        hint: "AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT+AZURE_STORAGE_KEY not set — falling back to DB base64",
      });
      return null;
    }
    default:
      if (CLOUD_SEAMS.includes(kind)) {
        log.warn("storage.cloud_seam_unconfigured", {
          kind,
          hint: "no bundled cloud SDK — falling back to DB base64",
        });
      }
      return null;
  }
}

/** True when an external object-storage backend is active. */
export function isObjectStorageConfigured(): boolean {
  return getMediaStorage() !== null;
}

/** Largest timing end (seconds) across word boundaries, or undefined. */
function durationFromWords(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let max = 0;
  for (const item of raw) {
    if (item && typeof item === "object" && "offset" in item && "duration" in item) {
      const offset = (item as { offset?: unknown }).offset;
      const duration = (item as { duration?: unknown }).duration;
      if (
        typeof offset === "number" &&
        Number.isFinite(offset) &&
        typeof duration === "number" &&
        Number.isFinite(duration)
      ) {
        const endSeconds = (offset + duration) / 1000;
        if (endSeconds > max) max = endSeconds;
      }
    }
  }
  return max > 0 ? max : undefined;
}

export type SpeechStorageMigrationResult = {
  storageKind: MediaStorageKind;
  /** True when no external storage is configured (nothing to migrate to). */
  skippedNoStorage: boolean;
  scanned: number;
  migrated: number;
  failed: number;
};

type MigrationDeps = {
  storage?: MediaStorage | null;
  /** Maximum rows to process in one pass (default: all eligible). */
  limit?: number;
};

/**
 * Idempotently moves `ArticleSpeech.audioBase64` payloads into object storage
 * (RW-049). Only rows WITH base64 and WITHOUT a storageKey are eligible, so a
 * re-run migrates nothing new. Base64 is cleared ONLY after the storage write
 * and `MediaAsset` record both succeed (never lose the payload). Degrades to a
 * no-op (skippedNoStorage) when object storage is unconfigured.
 */
export async function migrateArticleSpeechToStorage(
  deps: MigrationDeps = {},
): Promise<SpeechStorageMigrationResult> {
  const storage = deps.storage !== undefined ? deps.storage : getMediaStorage();
  const storageKind = mediaStorageKind();

  if (!storage) {
    return {
      storageKind,
      skippedNoStorage: true,
      scanned: 0,
      migrated: 0,
      failed: 0,
    };
  }

  const rows = await prisma.articleSpeech.findMany({
    where: { audioBase64: { not: null }, storageKey: null },
    select: {
      id: true,
      articleId: true,
      mimeType: true,
      voice: true,
      format: true,
      audioBase64: true,
      words: true,
    },
    ...(deps.limit ? { take: deps.limit } : {}),
  });

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.audioBase64) continue;
    try {
      const buffer = Buffer.from(row.audioBase64, "base64");
      const put = await storage.put({
        data: buffer,
        mimeType: row.mimeType,
        keyHint: "speech",
      });
      const durationSec = durationFromWords(row.words);

      await prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.upsert({
          where: { storageKey: put.storageKey },
          update: {
            kind: "speech",
            mimeType: row.mimeType,
            sizeBytes: put.sizeBytes,
            checksum: put.checksum,
            durationSec,
            voice: row.voice,
            format: row.format,
            articleId: row.articleId,
          },
          create: {
            storageKey: put.storageKey,
            kind: "speech",
            mimeType: row.mimeType,
            sizeBytes: put.sizeBytes,
            checksum: put.checksum,
            durationSec,
            voice: row.voice,
            format: row.format,
            articleId: row.articleId,
          },
          select: { id: true },
        });
        await tx.articleSpeech.update({
          where: { id: row.id },
          data: {
            storageKey: put.storageKey,
            mediaAssetId: asset.id,
            // Safe to clear now: payload is durably in object storage.
            audioBase64: null,
          },
        });
      });
      migrated += 1;
    } catch (err) {
      failed += 1;
      log.error("storage.speech_migration_failed", {
        articleId: row.articleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    storageKind,
    skippedNoStorage: false,
    scanned: rows.length,
    migrated,
    failed,
  };
}
