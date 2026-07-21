import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { getArticleSpeechAudio } from "@/lib/speech";

export const runtime = "nodejs";

const AUDIO_CACHE_CONTROL = "private, max-age=3600";
const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/i;

function audioHeaders(speechAudio: { mimeType: string; bytes: { byteLength: number } }) {
  return {
    "Content-Type": speechAudio.mimeType,
    "Content-Length": String(speechAudio.bytes.byteLength),
    "Accept-Ranges": "bytes",
    // Private: must not be served from a shared cache.
    "Cache-Control": AUDIO_CACHE_CONTROL,
  };
}

type ByteRange = { start: number; end: number };

function parseByteRange(rangeHeader: string, totalSize: number): ByteRange | null {
  const match = BYTE_RANGE_PATTERN.exec(rangeHeader);
  if (!match) return null;
  const [, startText, endText] = match;
  if ((!startText && !endText) || totalSize === 0) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(totalSize - suffixLength, 0),
      end: totalSize - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : totalSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= totalSize
  ) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, totalSize - 1) };
}

function rangeNotSatisfiable(speechAudio: { mimeType: string; bytes: { byteLength: number } }) {
  return new Response(null, {
    status: 416,
    headers: {
      ...audioHeaders(speechAudio),
      "Content-Length": "0",
      "Content-Range": `bytes */${speechAudio.bytes.byteLength}`,
    },
  });
}

/**
 * GET /api/reader/[id]/speech/audio
 *
 * Streams the narration audio for an article. Requires the caller to be
 * authenticated and able to read the article (same access gate as the speech
 * POST route). Serves bytes from local/Azure media storage using the row's
 * storageKey. Returns 404 when no audio has been generated yet or the storage
 * object is unavailable, and private Cache-Control so shared caches never serve
 * one user's audio to another. Supports single HTTP byte ranges so browser
 * media controls can seek to positions that have not been buffered yet.
 */
export const GET = createHandler({ params: idParams }, async ({ params, req, session }) => {
  await requireReadableArticle(params.id, session.user);

  const speechAudio = await getArticleSpeechAudio(params.id);
  if (!speechAudio) throw new ApiError(404, "Audio not found");

  const rangeHeader = req.headers.get("Range");
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, speechAudio.bytes.byteLength);
    if (!range) return rangeNotSatisfiable(speechAudio);

    const bytes = speechAudio.bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(bytes), {
      status: 206,
      headers: {
        ...audioHeaders({ ...speechAudio, bytes }),
        "Content-Range": `bytes ${range.start}-${range.end}/${speechAudio.bytes.byteLength}`,
      },
    });
  }

  return new Response(new Uint8Array(speechAudio.bytes), {
    status: 200,
    headers: audioHeaders(speechAudio),
  });
});
