/**
 * Provider registry for media storage adapters.
 *
 * Each provider module registers a factory keyed by its MediaStorageKind.
 * Adding a new provider requires:
 *   1. A new adapter file implementing MediaStorage.
 *   2. A `registerProvider` call (e.g. in runtime.ts).
 *   3. Contract tests for the new adapter.
 * No other modules need to change.
 */
import type { MediaStorage, MediaStorageKind } from "@/lib/storage/types";

type ProviderFactory = () => MediaStorage | null;

const providerRegistry = new Map<MediaStorageKind, ProviderFactory>();

/** Register a factory function for a storage kind. Later calls override earlier ones. */
export function registerProvider(kind: MediaStorageKind, factory: ProviderFactory): void {
  providerRegistry.set(kind, factory);
}

/**
 * Resolve the active MediaStorage for the given kind via the registry.
 * Returns null for unregistered kinds, or when the factory itself returns null.
 */
export function resolveProvider(kind: MediaStorageKind): MediaStorage | null {
  const factory = providerRegistry.get(kind);
  if (factory) return factory();
  return null;
}
