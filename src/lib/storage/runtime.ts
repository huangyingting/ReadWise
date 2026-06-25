import { createLogger } from "@/lib/observability/logger";
import { azureStorageConfig, AzureBlobMediaStorage } from "@/lib/storage/azure";
import { mediaStorageKind } from "@/lib/storage/config";
import { mediaStorageDir, FilesystemMediaStorage } from "@/lib/storage/filesystem";
import { registerProvider, resolveProvider } from "@/lib/storage/registry";
import type { MediaStorage } from "@/lib/storage/types";

const log = createLogger("storage");

// Register built-in providers. Each provider module owns its own config
// validation; adding a new provider only requires a new registerProvider call.
registerProvider("filesystem", () => new FilesystemMediaStorage(mediaStorageDir()));

registerProvider("azure", () => {
  const cfg = azureStorageConfig();
  if (cfg) return new AzureBlobMediaStorage(cfg);
  log.warn("storage.cloud_seam_unconfigured", {
    kind: "azure",
    hint: "AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT+AZURE_STORAGE_KEY not set — falling back to DB base64",
  });
  return null;
});

/**
 * Resolves the active {@link MediaStorage}, or `null` when object storage is
 * unconfigured (DB base64 mode). Intentionally NOT cached so a test (or a
 * runtime env change) is reflected immediately; construction is cheap.
 */
export function getMediaStorage(): MediaStorage | null {
  const kind = mediaStorageKind();
  // "database" is the explicit null-storage mode; skip registry lookup.
  if (kind === "database") return null;
  return resolveProvider(kind);
}

/** True when an external object-storage backend is active. */
export function isObjectStorageConfigured(): boolean {
  return getMediaStorage() !== null;
}