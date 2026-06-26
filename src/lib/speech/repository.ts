/**
 * ArticleSpeech repository and storage adapter (server-only).
 *
 * Owns all database reads/writes for ArticleSpeech rows, corrupt-cache
 * recovery, object-storage interactions, and MediaAsset upserts.  Callers
 * never touch raw storage keys or base64 audio directly.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { getMediaStorage } from "@/lib/storage";
import { timingEndSeconds, type SpeechWord } from "./timing";

const log = createLogger("speech");

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parses stored word timings from a Prisma Json field.
 * Returns null when the value is absent or has an unexpected shape so callers
 * can treat the row as corrupt and regenerate.
 */
export function parseStoredSpeechWords(
  raw: Prisma.JsonValue | null | undefined,
): SpeechWord[] | null {
  if (raw == null) {
    return null;
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const words: SpeechWord[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    const { word, offset, duration } = record;
    if (
      typeof word !== "string" ||
      !word.trim() ||
      !finiteNumber(offset) ||
      !finiteNumber(duration) ||
      offset < 0 ||
      duration < 0
    ) {
      return null;
    }
    words.push({ word, offset, duration });
  }

  return words.sort((a, b) => a.offset - b.offset);
}

/**
 * Resolves a playable `data:` URL for a stored speech row regardless of where
 * the audio lives. Prefers the inline base64 fallback column; otherwise reads
 * the bytes back from object storage via the configured backend. Returns null
 * when the audio cannot be located (e.g. storage unconfigured after a
 * migration).
 *
 * NOTE (REF-009): `ArticleSpeech.audioBase64` is intentionally retained.
 * Per AGENTS.md, object storage is OPTIONAL in local and test environments,
 * and DB base64 is the documented fallback when storage is not configured.
 * Removing this field would require a migration + backfill and break
 * local/test setups that never configure object storage.
 */
export async function resolveStoredAudioUrl(row: {
  mimeType: string;
  audioBase64: string | null;
  storageKey: string | null;
}): Promise<string | null> {
  if (row.audioBase64) {
    return `data:${row.mimeType};base64,${row.audioBase64}`;
  }
  if (row.storageKey) {
    const storage = getMediaStorage();
    if (!storage) return null;
    const bytes = await storage.get(row.storageKey);
    if (!bytes) return null;
    return `data:${row.mimeType};base64,${bytes.toString("base64")}`;
  }
  return null;
}

/** Largest word end timing (seconds) — used as the audio duration. */
function lastWordEnd(words: SpeechWord[]): number | undefined {
  let max = 0;
  for (const w of words) {
    const end = timingEndSeconds(w);
    if (end > max) max = end;
  }
  return max > 0 ? max : undefined;
}

/**
 * Persists synthesized audio to object storage (when configured) and upserts
 * both the MediaAsset record and the ArticleSpeech cache row.
 *
 * Falls back to inline base64 when object storage is unavailable or the write
 * fails, so narration always works regardless of storage configuration.
 * Cache-first / idempotent: the upsert overwrites any stale row with the same
 * articleId.
 */
export async function saveSpeechResult(params: {
  articleId: string;
  audio: Buffer;
  mimeType: string;
  voice: string;
  format: string;
  plainText: string;
  words: SpeechWord[];
}): Promise<void> {
  const { articleId, audio, mimeType, voice, format, plainText, words } =
    params;

  let audioBase64: string | null = audio.toString("base64");
  let storageKey: string | null = null;
  let mediaAssetId: string | null = null;

  const storage = getMediaStorage();
  if (storage) {
    try {
      const put = await storage.put({ data: audio, mimeType, keyHint: "speech" });
      const durationSec = lastWordEnd(words);
      const asset = await prisma.mediaAsset.upsert({
        where: { storageKey: put.storageKey },
        update: {
          kind: "speech",
          mimeType,
          sizeBytes: put.sizeBytes,
          checksum: put.checksum,
          durationSec,
          voice,
          format,
          articleId,
        },
        create: {
          storageKey: put.storageKey,
          kind: "speech",
          mimeType,
          sizeBytes: put.sizeBytes,
          checksum: put.checksum,
          durationSec,
          voice,
          format,
          articleId,
        },
        select: { id: true },
      });
      storageKey = put.storageKey;
      mediaAssetId = asset.id;
      audioBase64 = null; // durably stored externally
    } catch (err) {
      log.error("speech.storage_write_failed", {
        articleId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall back to inline base64 so narration still works.
      storageKey = null;
      mediaAssetId = null;
      audioBase64 = audio.toString("base64");
    }
  }

  await prisma.articleSpeech.upsert({
    where: { articleId },
    update: { voice, format, mimeType, audioBase64, storageKey, mediaAssetId, plainText, words },
    create: {
      articleId,
      voice,
      format,
      mimeType,
      audioBase64,
      storageKey,
      mediaAssetId,
      plainText,
      words,
    },
  });
}
