import { createLogger } from "@/lib/logger";
import { AzureBlobMediaStorage } from "@/lib/storage/azure";
import { azureStorageConfig, mediaStorageDir, mediaStorageKind } from "@/lib/storage/config";
import { FilesystemMediaStorage } from "@/lib/storage/filesystem";
import { CLOUD_SEAMS, type MediaStorage } from "@/lib/storage/types";

const log = createLogger("storage");

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