/**
 * Media storage configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import path from "node:path";
import { warnRuntimeConfig } from "./internal/log";
import { envValue } from "./env";
import type { MediaStorageKind } from "@/lib/storage/types";
const LOCAL_STORAGE_KIND_ALIASES = new Set(["", "filesystem", "local"]);
const DEFAULT_MEDIA_CONTAINER = "media";

function rawMediaStorageKind(): string {
  return (process.env.MEDIA_STORAGE ?? "").trim().toLowerCase();
}

function warnLocalStorageFallback(event: string, value: string): void {
  warnRuntimeConfig("storage", event, { value, fallback: "local" });
}

// ---------------------------------------------------------------------------
// Storage kind
// ---------------------------------------------------------------------------

/**
 * Reads the configured backend kind from the environment (defaults to local).
 * `filesystem` is accepted as a legacy alias for `local`.
 */
export function mediaStorageKind(): MediaStorageKind {
  const raw = rawMediaStorageKind();
  if (LOCAL_STORAGE_KIND_ALIASES.has(raw)) return "local";
  if (raw === "azure") return "azure";
  if (raw === "database") {
    warnLocalStorageFallback("storage.database_kind_removed", raw);
    return "local";
  }
  warnLocalStorageFallback("storage.unknown_kind", raw);
  return "local";
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
  const container = envValue("AZURE_STORAGE_CONTAINER") ?? DEFAULT_MEDIA_CONTAINER;
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
