/** Shared media-storage types and contracts. */

/** Storage backends selectable via `MEDIA_STORAGE`. */
export type MediaStorageKind = "database" | "filesystem" | "s3" | "azure" | "r2";

/** Cloud seams that intentionally degrade when not configured. */
export const CLOUD_SEAMS: readonly MediaStorageKind[] = ["s3", "azure", "r2"];

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

/**
 * Generalized result for any media migration run.
 * Not speech-specific — any media kind (speech, image, …) can use this.
 */
export type MediaMigrationResult = {
  /** The active storage kind during this migration run. */
  storageKind: MediaStorageKind;
  /** True when no object storage is configured; the run was skipped entirely. */
  skippedNoStorage: boolean;
  /** The media kind being migrated (e.g. "speech"). */
  mediaKind: string;
  scanned: number;
  migrated: number;
  failed: number;
};