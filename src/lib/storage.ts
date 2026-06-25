/**
 * Media object-storage abstraction (Epic RW-E009 — RW-049).
 *
 * Public facade for the storage package. Keep imports pointed at
 * `@/lib/storage`; implementation details live in `@/lib/storage/*` modules.
 */
export type {
  MediaMigrationResult,
  MediaStorage,
  MediaStorageKind,
  PutMediaInput,
  PutMediaResult,
} from "@/lib/storage/types";
export { sha256Hex } from "@/lib/storage/key";
export type {
  AzureStorageConfig,
  AzureStorageConnectionStringConfig,
} from "@/lib/storage/azure";
export { azureStorageConfig } from "@/lib/storage/azure";
export { mediaStorageDir } from "@/lib/storage/filesystem";
export { mediaStorageKind } from "@/lib/storage/config";
export {
  getMediaStorage,
  isObjectStorageConfigured,
} from "@/lib/storage/runtime";
export type { SpeechStorageMigrationResult } from "@/lib/storage/speech-migration";
export { migrateArticleSpeechToStorage } from "@/lib/storage/speech-migration";
