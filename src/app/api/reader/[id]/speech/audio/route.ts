import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { getMediaStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/reader/[id]/speech/audio
 *
 * Streams the narration audio for an article. Requires the caller to be
 * authenticated and able to read the article (same access gate as the speech
 * POST route). Serves bytes from object storage when a storageKey exists, or
 * falls back to the legacy audioBase64 column. Returns 404 when no audio has
 * been generated yet, and private Cache-Control so shared caches never serve
 * one user's audio to another.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  const context = articleAccessContext(session.user);
  const article = await getReadableArticleById(params.id, context);
  if (!article) throw new ApiError(404, "Article not found");

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

  // Fall back to legacy base64 column.
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
