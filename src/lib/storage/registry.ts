/**
 * Provider registry for media storage adapters.
 *
 * Each provider module registers a factory keyed by its MediaStorageKind.
 * Adding a new provider (e.g. S3, GCS) only requires:
 *   1. A new adapter file implementing MediaStorage.
 *   2. A `registerProvider` call (e.g. in runtime.ts).
 *   3. Contract tests for the new adapter.
 * No other modules need to change.
 */
import { createLogger } from "@/lib/observability/logger";
import { CLOUD_SEAMS, type MediaStorage, type MediaStorageKind } from "@/lib/storage/types";

const log = createLogger("storage");

type ProviderFactory = () => MediaStorage | null;

const providerRegistry = new Map<MediaStorageKind, ProviderFactory>();

/** Register a factory function for a storage kind. Later calls override earlier ones. */
export function registerProvider(kind: MediaStorageKind, factory: ProviderFactory): void {
  providerRegistry.set(kind, factory);
}

/**
 * Resolve the active MediaStorage for the given kind via the registry.
 * Returns null for the `database` kind (intentional DB-base64 fallback mode),
 * unregistered kinds, or when the factory itself returns null.
 * Warns once for recognized-but-unsupported cloud seams.
 */
export function resolveProvider(kind: MediaStorageKind): MediaStorage | null {
  if (kind === "database") return null;
  const factory = providerRegistry.get(kind);
  if (factory) return factory();
  if (CLOUD_SEAMS.includes(kind)) {
    log.warn("storage.cloud_seam_unconfigured", {
      kind,
      hint: "no bundled adapter registered — falling back to DB base64",
    });
  }
  return null;
}
