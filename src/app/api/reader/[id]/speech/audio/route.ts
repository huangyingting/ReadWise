import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getMediaStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/reader/[id]/speech/audio
 *
 * Streams the narration audio for an article. Requires the caller to be
 * authenticated and able to read the article (same access gate as the speech
 * POST route). Serves bytes from object storage when a storageKey exists, or
 * falls back to the `audioBase64` column (retained as the DB fallback when
 * object storage is not configured — see REF-009 decision). Returns 404 when
 * no audio has been generated yet, and private Cache-Control so shared caches
 * never serve one user's audio to another.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  await requireReadableArticle(params.id, session.user);

  const speechRow = await prisma.articleSpeech.findUnique({
    where: { articleId: params.id },
    select: {
      mimeType: true,
      audioBase64: true,
      storageKey: true,
    },
  });

  if (!speechRow) throw new ApiError(404, "Audio not found");

  let audioBytes: Buffer | null = null;

  // Prefer object-storage-backed audio.
  if (speechRow.storageKey) {
    const storage = getMediaStorage();
    if (storage) {
      audioBytes = await storage.get(speechRow.storageKey);
    }
  }

  // Fall back to the audioBase64 column when object storage is unavailable.
  // Intentionally retained per REF-009 decision: object storage is OPTIONAL
  // in local/test environments (per AGENTS.md), so DB base64 is the
  // documented fallback. Removal requires a migration + backfill.
  if (!audioBytes && speechRow.audioBase64) {
    audioBytes = Buffer.from(speechRow.audioBase64, "base64");
  }

  if (!audioBytes) throw new ApiError(404, "Audio not found");

  return new Response(new Uint8Array(audioBytes), {
    status: 200,
    headers: {
      "Content-Type": speechRow.mimeType,
      "Content-Length": String(audioBytes.byteLength),
      // Private: must not be served from a shared cache.
      "Cache-Control": "private, max-age=3600",
    },
  });
});
