/**
 * Media storage configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import path from "node:path";
import { createLogger } from "@/lib/observability/logger";
import { envValue } from "@/lib/runtime-config/env";
import type { MediaStorageKind } from "@/lib/storage/types";

const log = createLogger("storage");

// ---------------------------------------------------------------------------
// Storage kind
// ---------------------------------------------------------------------------

/** Reads the configured backend kind from the environment (defaults to database). */
export function mediaStorageKind(): MediaStorageKind {
  const raw = (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "database" || raw === "db" || raw === "none") return "database";
  if (raw === "filesystem" || raw === "local" || raw === "fs") return "filesystem";
  if (raw === "s3" || raw === "azure" || raw === "r2") return raw as MediaStorageKind;
  log.warn("storage.unknown_kind", { value: raw, fallback: "database" });
  return "database";
}

// ---------------------------------------------------------------------------
// Filesystem storage
// ---------------------------------------------------------------------------

/** Base directory for the filesystem backend (default `./.media`). */
export function mediaStorageDir(): string {
  const dir = envValue("MEDIA_STORAGE_DIR") ?? "";
  return dir ? path.resolve(dir) : path.resolve(process.cwd(), ".media");
}

// ---------------------------------------------------------------------------
// Azure Blob Storage
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
  const container = envValue("AZURE_STORAGE_CONTAINER") ?? "media";
  const connStr = envValue("AZURE_STORAGE_CONNECTION_STRING");
  if (connStr) {
    return { connectionString: connStr, container };
  }
  const accountName = envValue("AZURE_STORAGE_ACCOUNT");
  const accountKey = envValue("AZURE_STORAGE_KEY");
  if (accountName && accountKey) {
    return { accountName, accountKey, container };
  }
  return null;
}
