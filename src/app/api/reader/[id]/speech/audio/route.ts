import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getArticleSpeechAudio } from "@/lib/speech/repository";

export const runtime = "nodejs";

/**
 * GET /api/reader/[id]/speech/audio
 *
 * Streams the narration audio for an article. Requires the caller to be
 * authenticated and able to read the article (same access gate as the speech
 * POST route). Serves bytes from local/Azure media storage using the row's
 * storageKey. Returns 404 when no audio has been generated yet or the storage
 * object is unavailable, and private Cache-Control so shared caches never serve
 * one user's audio to another.
 */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  await requireReadableArticle(params.id, session.user);

  const speechAudio = await getArticleSpeechAudio(params.id);
  if (!speechAudio) throw new ApiError(404, "Audio not found");

  return new Response(new Uint8Array(speechAudio.bytes), {
    status: 200,
    headers: {
      "Content-Type": speechAudio.mimeType,
      "Content-Length": String(speechAudio.bytes.byteLength),
      // Private: must not be served from a shared cache.
      "Cache-Control": "private, max-age=3600",
    },
  });
});
