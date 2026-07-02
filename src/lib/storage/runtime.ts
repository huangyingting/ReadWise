import { createLogger } from "@/lib/observability/logger";
import { azureStorageConfig, AzureBlobMediaStorage } from "@/lib/storage/azure";
import { mediaStorageKind } from "@/lib/storage/config";
import { mediaStorageDir, FilesystemMediaStorage } from "@/lib/storage/filesystem";
import { registerProvider, resolveProvider } from "@/lib/storage/registry";
import type { MediaStorage } from "@/lib/storage/types";

const log = createLogger("storage");

// Register built-in providers. Each provider module owns its own config
// validation.
registerProvider("local", () => new FilesystemMediaStorage(mediaStorageDir()));

registerProvider("azure", () => {
  const cfg = azureStorageConfig();
  if (cfg) return new AzureBlobMediaStorage(cfg);
  log.warn("storage.azure_unconfigured", {
    kind: "azure",
    hint: "AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT+AZURE_STORAGE_KEY not set — speech audio will not be persisted until storage is configured",
  });
  return null;
});

/**
 * Resolves the active {@link MediaStorage}, or `null` when the selected backend
 * is unavailable. Intentionally NOT cached so a test (or a
 * runtime env change) is reflected immediately; construction is cheap.
 */
export function getMediaStorage(): MediaStorage | null {
  const kind = mediaStorageKind();
  return resolveProvider(kind);
}

/** True when a media storage backend is active. */
export function isObjectStorageConfigured(): boolean {
  return getMediaStorage() !== null;
}