import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { mediaStorageKind } from "@/lib/storage/config";
import { getMediaStorage } from "@/lib/storage/runtime";
import type { MediaMigrationResult, MediaStorage } from "@/lib/storage/types";

const log = createLogger("storage");

/** Largest timing end (seconds) across word boundaries, or undefined. */
function durationFromWords(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let max = 0;
  for (const item of raw) {
    if (item && typeof item === "object" && "offset" in item && "duration" in item) {
      const offset = (item as { offset?: unknown }).offset;
      const duration = (item as { duration?: unknown }).duration;
      if (
        typeof offset === "number" &&
        Number.isFinite(offset) &&
        typeof duration === "number" &&
        Number.isFinite(duration)
      ) {
        const endSeconds = (offset + duration) / 1000;
        if (endSeconds > max) max = endSeconds;
      }
    }
  }
  return max > 0 ? max : undefined;
}

/**
 * Backward-compatible alias.
 * @deprecated Use {@link MediaMigrationResult} directly.
 */
export type SpeechStorageMigrationResult = MediaMigrationResult;

type MigrationDeps = {
  storage?: MediaStorage | null;
  /** Maximum rows to process in one pass (default: all eligible). */
  limit?: number;
};

/**
 * Idempotently moves `ArticleSpeech.audioBase64` payloads into object storage
 * (RW-049). Only rows WITH base64 and WITHOUT a storageKey are eligible, so a
 * re-run migrates nothing new. Base64 is cleared ONLY after the storage write
 * and `MediaAsset` record both succeed (never lose the payload). Degrades to a
 * no-op (skippedNoStorage) when object storage is unconfigured.
 */
export async function migrateArticleSpeechToStorage(
  deps: MigrationDeps = {},
): Promise<MediaMigrationResult> {
  const storage = deps.storage !== undefined ? deps.storage : getMediaStorage();
  const storageKind = mediaStorageKind();

  if (!storage) {
    return {
      storageKind,
      skippedNoStorage: true,
      mediaKind: "speech",
      scanned: 0,
      migrated: 0,
      failed: 0,
    };
  }

  const rows = await prisma.articleSpeech.findMany({
    where: { audioBase64: { not: null }, storageKey: null },
    select: {
      id: true,
      articleId: true,
      mimeType: true,
      voice: true,
      format: true,
      audioBase64: true,
      words: true,
    },
    ...(deps.limit ? { take: deps.limit } : {}),
  });

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.audioBase64) continue;
    try {
      const buffer = Buffer.from(row.audioBase64, "base64");
      const put = await storage.put({
        data: buffer,
        mimeType: row.mimeType,
        keyHint: "speech",
      });
      const durationSec = durationFromWords(row.words);

      await prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.upsert({
          where: { storageKey: put.storageKey },
          update: {
            kind: "speech",
            mimeType: row.mimeType,
            sizeBytes: put.sizeBytes,
            checksum: put.checksum,
            durationSec,
            voice: row.voice,
            format: row.format,
            articleId: row.articleId,
          },
          create: {
            storageKey: put.storageKey,
            kind: "speech",
            mimeType: row.mimeType,
            sizeBytes: put.sizeBytes,
            checksum: put.checksum,
            durationSec,
            voice: row.voice,
            format: row.format,
            articleId: row.articleId,
          },
          select: { id: true },
        });
        await tx.articleSpeech.update({
          where: { id: row.id },
          data: {
            storageKey: put.storageKey,
            mediaAssetId: asset.id,
            audioBase64: null,
          },
        });
      });
      migrated += 1;
    } catch (err) {
      failed += 1;
      log.error("storage.speech_migration_failed", {
        articleId: row.articleId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    storageKind,
    skippedNoStorage: false,
    mediaKind: "speech",
    scanned: rows.length,
    migrated,
    failed,
  };
}