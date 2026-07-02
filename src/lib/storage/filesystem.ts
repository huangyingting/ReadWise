import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaStorage, PutMediaInput, PutMediaResult } from "@/lib/storage/types";
import { extensionForMime, normalizeExtension, sanitizeKeyHint, sha256Hex } from "@/lib/storage/key";
export { mediaStorageDir } from "@/lib/runtime-config/storage";

/** Filesystem-backed {@link MediaStorage}. Content-addressed, traversal-safe. */
export class FilesystemMediaStorage implements MediaStorage {
  readonly kind = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** Confines a storage key to `baseDir`, rejecting traversal escapes. */
  private resolve(storageKey: string): string {
    const full = path.resolve(this.baseDir, storageKey);
    const base = path.resolve(this.baseDir);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error("storage key escapes media base directory");
    }
    return full;
  }

  async put(input: PutMediaInput): Promise<PutMediaResult> {
    const checksum = sha256Hex(input.data);
    const ext = normalizeExtension(input.extension) ?? extensionForMime(input.mimeType);
    const prefix = sanitizeKeyHint(input.keyHint);
    const storageKey = `${prefix}/${checksum}${ext}`;
    const full = this.resolve(storageKey);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.data);
    return { storageKey, sizeBytes: input.data.byteLength, checksum };
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(storageKey));
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(storageKey));
    } catch {
      // Idempotent: a missing file is already "deleted".
    }
  }
}