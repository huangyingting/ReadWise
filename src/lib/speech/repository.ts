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
 * Resolves playback metadata and a `data:` URL from the canonical MediaAsset.
 * Metadata remains available when the storage object itself cannot be read.
 */
export async function resolveStoredSpeechMedia(row: {
  mediaAssetId: string | null;
}): Promise<{ audio: string | null; mimeType: string; voice: string | null } | null> {
  const asset = await findStoredMediaAsset(row.mediaAssetId);
  if (!asset) return null;
  const bytes = await readStorageAudioBytes(asset);
  return {
    audio: bytes ? `data:${asset.mimeType};base64,${bytes.toString("base64")}` : null,
    mimeType: asset.mimeType,
    voice: asset.voice,
  };
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

async function findStoredMediaAsset(mediaAssetId: string | null) {
  if (!mediaAssetId) return null;
  return prisma.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: {
      storageKey: true,
      mimeType: true,
      voice: true,
    },
  });
}

export type ArticleSpeechAudio = {
  mimeType: string;
  bytes: Buffer;
};

export async function getArticleSpeechAudio(articleId: string): Promise<ArticleSpeechAudio | null> {
  const speechRow = await prisma.articleSpeech.findUnique({
    where: { articleId },
    select: {
      mediaAssetId: true,
    },
  });

  if (!speechRow) return null;
  const asset = await findStoredMediaAsset(speechRow.mediaAssetId);
  if (!asset) return null;
  const bytes = await readStorageAudioBytes(asset);
  if (!bytes) return null;

  return { mimeType: asset.mimeType, bytes };
}

function mediaAssetData(params: {
  mimeType: string;
  voice: string;
  articleId: string;
}) {
  const { mimeType, voice, articleId } = params;
  return {
    kind: "speech" as const,
    mimeType,
    voice,
    articleId,
  };
}

function articleSpeechData(params: {
  mediaAssetId: string;
  words: ReturnType<typeof createSpeechTimingPayloadV2>;
}) {
  const { mediaAssetId, words } = params;
  return {
    mediaAssetId,
    words,
  };
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
  provider?: SpeechTimingProvider | string;
  words: SpeechWord[];
}): Promise<boolean> {
  const { articleId, audio, mimeType, voice, provider = "azure", words } = params;
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
    put = await storage.put({
      data: audio,
      mimeType,
      keyHint: "speech",
      keyScope: articleId,
    });
  } catch (err) {
    log.error("speech.storage_write_failed", {
      articleId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  const assetData = mediaAssetData({
    mimeType,
    voice,
    articleId,
  });
  await prisma.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.upsert({
      where: { storageKey: put.storageKey },
      update: assetData,
      create: {
        storageKey: put.storageKey,
        ...assetData,
      },
      select: { id: true },
    });

    const speechData = articleSpeechData({
      mediaAssetId: asset.id,
      words: timingPayload,
    });
    await tx.articleSpeech.upsert({
      where: { articleId },
      update: speechData,
      create: {
        articleId,
        ...speechData,
      },
    });
  });
  return true;
}
