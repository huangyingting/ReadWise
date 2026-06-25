import path from "node:path";
import { createLogger } from "@/lib/logger";
import type { MediaStorageKind } from "@/lib/storage/types";

const log = createLogger("storage");

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