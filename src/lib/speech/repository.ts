/**
 * ArticleSpeech repository and storage adapter (server-only).
 *
 * Owns all database reads/writes for ArticleSpeech rows, corrupt-cache
 * recovery, media-storage interactions, and MediaAsset upserts. Callers never
 * touch raw storage keys directly.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { getMediaStorage, type PutMediaResult } from "@/lib/storage";
import {
  createSpeechTimingPayloadV2,
  parseSpeechTimingPayload,
  timingEndSeconds,
  type ParsedSpeechTimingPayload,
  type SpeechTimingProvider,
  type SpeechWord,
} from "./timing";

const log = createLogger("speech");

/**
 * Parses stored timing payloads from a Prisma Json field.
 * Returns null when the value is absent or has an unexpected shape so callers
 * can treat the row as corrupt and regenerate.
 */
export function parseStoredSpeechTimingPayload(
  raw: Prisma.JsonValue | null | undefined,
): ParsedSpeechTimingPayload | null {
  if (raw == null) {
    return null;
  }
  return parseSpeechTimingPayload(raw);
}

/** Backward-compatible helper for callers that only need normalized words. */
export function parseStoredSpeechWords(
  raw: Prisma.JsonValue | null | undefined,
): SpeechWord[] | null {
  return parseStoredSpeechTimingPayload(raw)?.words ?? null;
}

/**
 * Resolves a playable `data:` URL for a stored speech row by reading the bytes
 * from the configured media-storage backend. Returns null when the row has no
 * storage key or the backend cannot provide the object.
 */
export async function resolveStoredAudioUrl(row: {
  mimeType: string;
  storageKey: string | null;
}): Promise<string | null> {
  const bytes = await readStorageAudioBytes(row);
  if (!bytes) return null;
  return `data:${row.mimeType};base64,${bytes.toString("base64")}`;
}

async function readStorageAudioBytes(row: { storageKey: string | null }): Promise<Buffer | null> {
  if (row.storageKey) {
    const storage = getMediaStorage();
    if (!storage) return null;
    const bytes = await storage.get(row.storageKey);
    if (!bytes) return null;
    return bytes;
  }
  return null;
}

export async function resolveStoredAudioBytes(
  row: { storageKey: string | null },
): Promise<Buffer | null> {
  return readStorageAudioBytes(row);
}

export type ArticleSpeechAudio = {
  mimeType: string;
  bytes: Buffer;
};

export async function getArticleSpeechAudio(articleId: string): Promise<ArticleSpeechAudio | null> {
  const speechRow = await prisma.articleSpeech.findUnique({
    where: { articleId },
    select: {
      mimeType: true,
      storageKey: true,
    },
  });

  if (!speechRow) return null;

  const bytes = await resolveStoredAudioBytes(speechRow);
  if (!bytes) return null;

  return { mimeType: speechRow.mimeType, bytes };
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
 * Persists synthesized audio to media storage and upserts both the MediaAsset
 * record and the ArticleSpeech cache row.
 *
 * Database audio fallback has intentionally been removed: if local/Azure media
 * storage is unavailable or the write fails, the synthesis result is not cached.
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
  provider?: SpeechTimingProvider | string;
  words: SpeechWord[];
}): Promise<boolean> {
  const { articleId, audio, mimeType, voice, format, plainText, provider = "azure", words } =
    params;
  const timingPayload = createSpeechTimingPayloadV2(provider, words);

  const storage = getMediaStorage();
  if (!storage) {
    log.error("speech.storage_unavailable", {
      articleId,
      error: "No local or Azure media storage backend is available",
    });
    return false;
  }

  let put: PutMediaResult;
  try {
    put = await storage.put({ data: audio, mimeType, keyHint: "speech" });
  } catch (err) {
    log.error("speech.storage_write_failed", {
      articleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

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

  await prisma.articleSpeech.upsert({
    where: { articleId },
    update: {
      voice,
      format,
      mimeType,
      storageKey: put.storageKey,
      mediaAssetId: asset.id,
      plainText,
      words: timingPayload,
    },
    create: {
      articleId,
      voice,
      format,
      mimeType,
      storageKey: put.storageKey,
      mediaAssetId: asset.id,
      plainText,
      words: timingPayload,
    },
  });
  return true;
}
